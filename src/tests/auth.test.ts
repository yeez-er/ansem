// Task 4 (spec 009A): auth-aware tRPC context + protectedProcedure.
// { userId, isAdmin } is derived from the Clerk session (never from input);
// a Clerk failure degrades to signed-out (fail closed via protectedProcedure).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import {
  adminProcedure,
  createCallerFactory,
  createTRPCContext,
  createTRPCRouter,
  parseAdminUserIds,
  protectedProcedure,
} from "@/server/api/trpc";

const mockedAuth = vi.mocked(auth);

function mockSession(userId: string | null) {
  mockedAuth.mockResolvedValue({ userId } as Awaited<ReturnType<typeof auth>>);
}

beforeEach(() => {
  mockedAuth.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseAdminUserIds", () => {
  it.each([
    [undefined, []],
    ["", []],
    ["   ", []],
    ["user_a", ["user_a"]],
    [" user_a , user_b ", ["user_a", "user_b"]],
    ["user_a,,user_b,", ["user_a", "user_b"]],
  ])("parses %j into %j", (raw, expected) => {
    expect(parseAdminUserIds(raw)).toStrictEqual(expected);
  });
});

describe("createTRPCContext session derivation", () => {
  it("signed out: userId null, isAdmin false", async () => {
    mockSession(null);
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.userId).toBeNull();
    expect(ctx.isAdmin).toBe(false);
  });

  it("signed in: carries the session userId", async () => {
    mockSession("user_regular");
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.userId).toBe("user_regular");
    expect(ctx.isAdmin).toBe(false);
  });

  it("admin: session userId listed in ADMIN_USER_IDS (whitespace tolerated)", async () => {
    vi.stubEnv("ADMIN_USER_IDS", " user_admin , user_other ");
    mockSession("user_admin");
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.isAdmin).toBe(true);
  });

  it("empty ADMIN_USER_IDS means NO admins, never everyone", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    mockSession("user_admin");
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.isAdmin).toBe(false);
  });

  it("Clerk failure degrades to signed-out, never an unhandled rejection", async () => {
    mockedAuth.mockRejectedValue(new Error("clerkMiddleware not detected"));
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.userId).toBeNull();
    expect(ctx.isAdmin).toBe(false);
  });
});

describe("protectedProcedure", () => {
  const testRouter = createTRPCRouter({
    whoami: protectedProcedure.query(({ ctx }) => ctx.userId),
  });
  const createCaller = createCallerFactory(testRouter);

  it("unauthenticated call fails with UNAUTHORIZED", async () => {
    mockSession(null);
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    const result = await caller.whoami().catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("authenticated call passes the session userId through", async () => {
    mockSession("user_regular");
    const caller = createCaller(
      await createTRPCContext({ headers: new Headers() }),
    );
    await expect(caller.whoami()).resolves.toBe("user_regular");
  });
});

describe("adminProcedure", () => {
  const testRouter = createTRPCRouter({
    secret: adminProcedure.query(({ ctx }) => ctx.userId),
  });
  const createCaller = createCallerFactory(testRouter);

  async function caller() {
    return createCaller(await createTRPCContext({ headers: new Headers() }));
  }

  it("anonymous → UNAUTHORIZED (fails closed before the admin check)", async () => {
    mockSession(null);
    const result = await (await caller()).secret().catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("authenticated non-admin → FORBIDDEN", async () => {
    mockSession("user_regular"); // ADMIN_USER_IDS unset ⇒ nobody is admin
    const result = await (await caller()).secret().catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin listed in ADMIN_USER_IDS → passes through", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "user_admin");
    mockSession("user_admin");
    await expect((await caller()).secret()).resolves.toBe("user_admin");
  });
});
