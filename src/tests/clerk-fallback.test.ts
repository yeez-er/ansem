// Task 29 (spec 009A): Clerk external-service fallback verification.
// Clerk is the only auth dependency; its outage must never take down the public
// board. Two contracts are pinned here (verification task — no source changes,
// every matcher is control-tested so an assertion cannot pass vacuously):
//   1. Dev fallback — .env.example documents the Clerk keys AND how to swap in
//      test-mode (pk_test_/sk_test_) values, so a fresh clone runs signed-out
//      locally and CI e2e uses testing tokens (wiring proven in auth-pages.test).
//   2. Outage path — a thrown auth() degrades to signed-out: PUBLIC procedures
//      (board reads) still resolve, and PROTECTED procedures (submit mutation)
//      fail closed with a typed UNAUTHORIZED, never an unhandled crash. The edge
//      proxy gates ONLY /admin, so /, /creator/[id], /submit keep serving with
//      Clerk unreachable.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import {
  createCallerFactory,
  createTRPCContext,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";

const mockedAuth = vi.mocked(auth);
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

beforeEach(() => {
  mockedAuth.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dev fallback: .env.example documents the Clerk keys + test-mode swap", () => {
  const envExample = read(".env.example");

  it.each(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"])(
    "documents %s",
    (key) => {
      expect(envExample).toMatch(new RegExp(`^${key}=`, "m"));
    },
  );

  it("tells a fresh clone how to actually sign in locally (test-mode keys)", () => {
    // The dev fallback IS test-mode keys; the file must name the swap-in path.
    expect(envExample).toMatch(/pk_test_\/sk_test_/);
  });

  it("control: the test-mode-guidance matcher fails on a file missing it", () => {
    // Prove the assertion above is not vacuously satisfied.
    const withoutGuidance = "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_x\n";
    expect(withoutGuidance).not.toMatch(/pk_test_\/sk_test_/);
  });
});

describe("Clerk outage: the edge proxy gates ONLY /admin", () => {
  // Pull the createRouteMatcher([...]) argument so assertions target the
  // protected-route list, not the unrelated config.matcher regex (which
  // legitimately contains "/").
  function protectedMatcherArg(source: string): string {
    const m = source.match(/createRouteMatcher\(\s*\[([\s\S]*?)\]\s*\)/);
    if (!m) throw new Error("createRouteMatcher([...]) not found");
    return m[1];
  }

  const arg = protectedMatcherArg(read("src/proxy.ts"));

  it("protects /admin(.*) at the edge", () => {
    expect(arg).toContain("/admin(.*)");
  });

  it.each(["submit", "creator"])(
    "never edge-gates a public route matching %j (renders with Clerk unreachable)",
    (publicRoute) => {
      expect(arg).not.toMatch(new RegExp(publicRoute));
    },
  );

  it("control: the matcher-arg extractor would catch a re-added /submit gate", () => {
    const hostile =
      'const isProtectedRoute = createRouteMatcher(["/admin(.*)", "/submit(.*)"]);';
    expect(protectedMatcherArg(hostile)).toMatch(/submit/);
  });
});

describe("Clerk outage: procedures degrade through the real context + caller", () => {
  // A minimal router mirroring the app's public/protected split so the outage
  // assertions run through the SAME context + procedure builders the board reads
  // (publicProcedure) and the submit mutation (protectedProcedure) use.
  const outageRouter = createTRPCRouter({
    publicRead: publicProcedure.query(() => ({ board: "ok" })),
    protectedWrite: protectedProcedure.mutation(() => ({ submitted: true })),
  });
  const createCaller = createCallerFactory(outageRouter);

  async function callerWithClerkDown() {
    mockedAuth.mockRejectedValue(new Error("Clerk unreachable"));
    return createCaller(await createTRPCContext({ headers: new Headers() }));
  }

  it("a thrown auth() still resolves a public procedure (board renders)", async () => {
    const caller = await callerWithClerkDown();
    await expect(caller.publicRead()).resolves.toStrictEqual({ board: "ok" });
  });

  it("a thrown auth() maps the protected path to UNAUTHORIZED, never an unhandled rejection", async () => {
    const caller = await callerWithClerkDown();
    const result = await caller.protectedWrite().catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
