// Task 18 (spec 007): leaderboard.creator — one creator's public profile.
// Unknown id or banned → null (single-entity "no data" rule; never {}).
// Summaries REUSE the board queries so creator-page numbers can never
// disagree with the board (same window semantics, same visibility rules);
// boards are small in v1 and Task 19 caches 60s per creatorId.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure } from "@/server/api/trpc";
import {
  alltimeBoard,
  dailyBoard,
  newestFirst,
} from "@/server/db/queries/leaderboard";
import { creators, posts } from "@/server/db/schema";
import { cachedQuery } from "./cache";
import {
  type PublicCreator,
  type PublicPost,
  type ScoreSummary,
  toPublicCreator,
  toPublicPost,
  toScoreSummary,
} from "./dto";

export const CREATOR_POSTS_LIMIT = 50;

export type CreatorProfile = {
  creator: PublicCreator;
  alltime: ScoreSummary;
  daily: ScoreSummary;
  posts: PublicPost[];
};

const creatorInput = z.strictObject({ creatorId: z.uuid() });

type CreatorInput = z.infer<typeof creatorInput>;

export const creator = publicProcedure
  .input(creatorInput)
  .query(({ ctx, input }) => {
    const compute = cachedQuery(
      "leaderboard.creator",
      async (i: CreatorInput): Promise<CreatorProfile | null> => {
        const [row] = await ctx.db
          .select()
          .from(creators)
          .where(eq(creators.id, i.creatorId))
          .limit(1);
        if (row === undefined || row.isBanned) return null;

        // Read once per request, after the cache miss (spec 007 / Task 19).
        const now = new Date();
        const [daily, alltime, postRows] = await Promise.all([
          dailyBoard(ctx.db, { now }),
          alltimeBoard(ctx.db),
          ctx.db
            .select()
            .from(posts)
            .where(
              and(eq(posts.creatorId, row.id), eq(posts.status, "approved")),
            )
            .orderBy(...newestFirst())
            .limit(CREATOR_POSTS_LIMIT),
        ]);

        const mine = (entry: { creator: { id: string } }) =>
          entry.creator.id === row.id;
        return {
          creator: toPublicCreator(row),
          alltime: toScoreSummary(alltime.entries.find(mine)),
          daily: toScoreSummary(daily.entries.find(mine)),
          posts: postRows.map(toPublicPost),
        };
      },
    );
    return compute(input);
  });
