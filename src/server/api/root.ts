import { createTRPCRouter, publicProcedure } from "./trpc";

export const appRouter = createTRPCRouter({
  system: createTRPCRouter({
    health: publicProcedure.query(() => ({
      ok: true,
      time: new Date().toISOString(),
    })),
  }),
});

export type AppRouter = typeof appRouter;
