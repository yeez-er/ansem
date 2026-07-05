import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { getDb } from "@/server/db";

export function createTRPCContext(opts: { headers: Headers }) {
  return {
    headers: opts.headers,
    // getter keeps context construction env-free: procedures that never read
    // ctx.db (system.health) must work without DATABASE_URL
    get db() {
      return getDb();
    },
  };
}

export type TRPCContext = ReturnType<typeof createTRPCContext>;

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson });

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
