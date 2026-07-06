// Spec 009B: admin.banCreator — ban/unban a creator. On ban, is_banned and the
// bulk-reject of the creator's still-pending posts happen in ONE transaction,
// so a concurrent approve of one of those posts cannot survive: both writers
// contend on the post row's `status = 'pending'` guard and exactly one wins.
// Unban only flips is_banned back — rejections are independent moderation
// decisions and are never resurrected.
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure } from "@/server/api/trpc";
import { creators, posts } from "@/server/db/schema";
import { logAdminAudit } from "./audit";

export const banCreator = adminProcedure
  .input(z.object({ creatorId: z.uuid(), banned: z.boolean() }))
  .mutation(async ({ ctx, input }) => {
    // adminProcedure guarantees a session; re-check narrows the type.
    const actor = ctx.userId;
    if (actor === null) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const creator = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .update(creators)
        .set({ isBanned: input.banned, updatedAt: new Date() })
        .where(eq(creators.id, input.creatorId))
        .returning();
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "CREATOR_NOT_FOUND",
        });
      }
      if (input.banned) {
        // Same transaction: reject every still-pending post so a concurrent
        // approve either loses the row lock (its guard no longer matches) or
        // lands an approved post that the creator ban hides from the board.
        await tx
          .update(posts)
          .set({ status: "rejected" })
          .where(
            and(
              eq(posts.creatorId, input.creatorId),
              eq(posts.status, "pending"),
            ),
          );
      }
      return row;
    });

    logAdminAudit(
      actor,
      input.banned ? "creator.ban" : "creator.unban",
      creator.id,
    );
    return creator;
  });
