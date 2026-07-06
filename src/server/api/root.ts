import { adminRouter } from "./routers/admin";
import { leaderboardRouter } from "./routers/leaderboard";
import { submissionsRouter } from "./routers/submissions";
import { createTRPCRouter, publicProcedure } from "./trpc";

export const appRouter = createTRPCRouter({
  system: createTRPCRouter({
    health: publicProcedure.query(() => ({
      ok: true,
      time: new Date().toISOString(),
    })),
  }),
  submissions: submissionsRouter,
  leaderboard: leaderboardRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
