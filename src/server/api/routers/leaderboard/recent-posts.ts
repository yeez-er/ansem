// Task 18 (spec 007): leaderboard.recentPosts — the home-page ticker. Latest
// approved posts across all platforms, newest first, each embedding its
// creator. Visibility rides the same SQL predicate as the boards, so the
// feed can never show a post the boards would hide. Task 19 caches the
// response 60s per input key.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure } from "@/server/api/trpc";
import { newestFirst, visibleFilter } from "@/server/db/queries/leaderboard";
import { creators, posts } from "@/server/db/schema";
import { cachedQuery } from "./cache";
import {
  type PublicCreator,
  type PublicPost,
  toPublicCreator,
  toPublicPost,
} from "./dto";

export type RecentPost = PublicPost & { creator: PublicCreator };

const recentPostsInput = z.strictObject({
  limit: z.number().int().min(1).max(50).default(12),
});

type RecentPostsInput = z.infer<typeof recentPostsInput>;

export const recentPosts = publicProcedure
  .input(recentPostsInput)
  .query(({ ctx, input }): Promise<RecentPost[]> => {
    const compute = cachedQuery(
      "leaderboard.recentPosts",
      async (i: RecentPostsInput) => {
        const rows = await ctx.db
          .select({ post: posts, creator: creators })
          .from(posts)
          .innerJoin(creators, eq(posts.creatorId, creators.id))
          .where(visibleFilter())
          .orderBy(...newestFirst())
          .limit(i.limit);

        return rows.map((row) => ({
          ...toPublicPost(row.post),
          creator: toPublicCreator(row.creator),
        }));
      },
    );
    return compute(input);
  });
