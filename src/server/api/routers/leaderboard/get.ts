// Task 18 (spec 007): leaderboard.get — the public ranked board. The heavy
// lifting lives in the query layer (Task 17); this procedure validates
// input, reads the clock ONCE per request (Task 19's cache will read it
// after a miss), pages the ranked entries, and serializes through the DTO
// allow-lists.
import { z } from "zod";
import { publicProcedure } from "@/server/api/trpc";
import {
  alltimeBoard,
  type BoardPlatform,
  dailyBoard,
} from "@/server/db/queries/leaderboard";
import { toBoardEntry, toPublicWindow } from "./dto";

const getInput = z.strictObject({
  period: z.enum(["daily", "alltime"]),
  platform: z.enum(["x", "tiktok", "instagram", "all"]).default("all"),
  cursor: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(25),
});

export const get = publicProcedure
  .input(getInput)
  .query(async ({ ctx, input }) => {
    const platform: BoardPlatform | undefined =
      input.platform === "all" ? undefined : input.platform;
    const board =
      input.period === "daily"
        ? await dailyBoard(ctx.db, { now: new Date(), platform })
        : await alltimeBoard(ctx.db, { platform });

    const end = input.cursor + input.limit;
    return {
      entries: board.entries.slice(input.cursor, end).map(toBoardEntry),
      nextCursor: end < board.entries.length ? end : null,
      window: toPublicWindow(board.window),
    };
  });
