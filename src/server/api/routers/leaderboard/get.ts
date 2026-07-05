// Task 18 (spec 007): leaderboard.get — the public ranked board. The heavy
// lifting lives in the query layer (Task 17); this procedure validates
// input, pages the ranked entries, and serializes through the DTO
// allow-lists. Task 19 caches the response 60s per input key; the clock is
// read INSIDE the cached function — once per request, only after a miss — so
// a cached daily board straddles a window boundary for at most the TTL.
import { z } from "zod";
import { publicProcedure } from "@/server/api/trpc";
import {
  alltimeBoard,
  type BoardPlatform,
  dailyBoard,
} from "@/server/db/queries/leaderboard";
import { cachedQuery } from "./cache";
import { toBoardEntry, toPublicWindow } from "./dto";

const getInput = z.strictObject({
  period: z.enum(["daily", "alltime"]),
  platform: z.enum(["x", "tiktok", "instagram", "all"]).default("all"),
  cursor: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(25),
});

type GetInput = z.infer<typeof getInput>;

export const get = publicProcedure.input(getInput).query(({ ctx, input }) => {
  const compute = cachedQuery("leaderboard.get", async (i: GetInput) => {
    const platform: BoardPlatform | undefined =
      i.platform === "all" ? undefined : i.platform;
    const board =
      i.period === "daily"
        ? await dailyBoard(ctx.db, { now: new Date(), platform })
        : await alltimeBoard(ctx.db, { platform });

    const end = i.cursor + i.limit;
    return {
      entries: board.entries.slice(i.cursor, end).map(toBoardEntry),
      nextCursor: end < board.entries.length ? end : null,
      window: toPublicWindow(board.window),
    };
  });
  return compute(input);
});
