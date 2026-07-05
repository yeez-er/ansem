import { auth } from "@clerk/nextjs/server";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getDb } from "@/server/db";

// Whitespace tolerated; blank/empty input means NO admins — never "everyone".
export function parseAdminUserIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export async function createTRPCContext(opts: { headers: Headers }) {
  // Clerk is an external service: a failure (or a call path that never went
  // through clerkMiddleware, e.g. direct route-handler tests) degrades to
  // signed-out. protectedProcedure then fails closed with UNAUTHORIZED.
  let userId: string | null;
  try {
    userId = (await auth()).userId;
  } catch {
    userId = null;
  }

  return {
    headers: opts.headers,
    userId,
    isAdmin:
      userId !== null &&
      parseAdminUserIds(process.env.ADMIN_USER_IDS).includes(userId),
    // getter keeps context construction env-free: procedures that never read
    // ctx.db (system.health) must work without DATABASE_URL
    get db() {
      return getDb();
    },
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson });

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

// next() deliberately has no ctx override: an override makes tRPC spread the
// original context, which would evaluate the lazy `db` getter and demand
// DATABASE_URL on auth-only code paths.
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.userId === null) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next();
});
