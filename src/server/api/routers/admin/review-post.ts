// Spec 009B: admin.reviewPost — moderate a pending submission. The status
// transition is a single guarded UPDATE (`WHERE status = 'pending'`) so it is
// the concurrency gate: a re-review or a race that already moved the row off
// pending updates zero rows and is rejected, never silently double-applied.
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure } from "@/server/api/trpc";
import { posts } from "@/server/db/schema";
import { logAdminAudit } from "./audit";

export const reviewPost = adminProcedure
  .input(
    z.object({
      postId: z.uuid(),
      decision: z.enum(["approved", "rejected"]),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // adminProcedure guarantees a session; re-check narrows the type (the
    // middleware deliberately never overrides ctx — see trpc.ts).
    const actor = ctx.userId;
    if (actor === null) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const [updated] = await ctx.db
      .update(posts)
      .set({ status: input.decision })
      .where(and(eq(posts.id, input.postId), eq(posts.status, "pending")))
      .returning();

    if (!updated) {
      // Zero rows updated: either the post does not exist, or it is no longer
      // pending (already reviewed, or a concurrent ban rejected it). Disambiguate
      // so callers get NOT_FOUND vs PRECONDITION_FAILED.
      const [existing] = await ctx.db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.id, input.postId))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "POST_NOT_FOUND" });
      }
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "ALREADY_REVIEWED",
      });
    }

    logAdminAudit(actor, `post.${input.decision}`, updated.id);
    return updated;
  });
