// Spec 009B: admin.pendingPosts — the moderation queue. Every post awaiting
// review, oldest-first (FIFO: the longest-waiting submission is triaged first).
// This is an admin-only view, so it deliberately carries the submitter's Clerk
// id — it is NOT a public DTO and must never back a public route.
import { asc, eq } from "drizzle-orm";
import { adminProcedure } from "@/server/api/trpc";
import { creators, posts } from "@/server/db/schema";

export const pendingPosts = adminProcedure.query(async ({ ctx }) => {
  return (
    ctx.db
      .select({
        id: posts.id,
        platform: posts.platform,
        url: posts.url, // link out to the source post
        submittedByUserId: posts.submittedByUserId, // Clerk id or null (discovery)
        submittedAt: posts.createdAt,
        creator: {
          id: creators.id,
          handle: creators.handle,
          displayName: creators.displayName,
        },
      })
      .from(posts)
      .innerJoin(creators, eq(posts.creatorId, creators.id))
      .where(eq(posts.status, "pending"))
      // Oldest submission first; id as a stable total-order tie-break.
      .orderBy(asc(posts.createdAt), asc(posts.id))
  );
});
