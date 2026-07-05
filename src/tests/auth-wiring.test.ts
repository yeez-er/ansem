// Task 4 (spec 009A): registration, not just existence — the Clerk proxy
// (Next 16 renamed the middleware convention to proxy) must gate /submit and
// /admin/** and run on the tRPC api path (so auth() is available to context),
// and the layout must mount ClerkProvider inside <body>
// (cache-components-safe placement, Clerk Core 3).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("clerk route protection (proxy)", () => {
  it("src/proxy.ts uses clerkMiddleware + createRouteMatcher", () => {
    const middleware = read("src/proxy.ts");
    expect(middleware).toMatch(
      /import\s+\{[^}]*clerkMiddleware[^}]*\}\s+from\s+["']@clerk\/nextjs\/server["']/,
    );
    expect(middleware).toContain("createRouteMatcher");
  });

  it("protects /submit and /admin/** via auth.protect", () => {
    const middleware = read("src/proxy.ts");
    expect(middleware).toContain('"/submit(.*)"');
    expect(middleware).toContain('"/admin(.*)"');
    expect(middleware).toMatch(/await\s+auth\.protect\(\)/);
  });

  it("matcher covers api/trpc routes so tRPC context can read the session", () => {
    const middleware = read("src/proxy.ts");
    expect(middleware).toMatch(/matcher:\s*\[/);
    expect(middleware).toContain("/(api|trpc)(.*)");
  });
});

describe("clerk provider registration", () => {
  it("layout imports ClerkProvider from @clerk/nextjs", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(
      /import\s+\{[^}]*ClerkProvider[^}]*\}\s+from\s+["']@clerk\/nextjs["']/,
    );
  });

  it("mounts <ClerkProvider> inside <body>, wrapping the app", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/<body[^>]*>[\s\S]*<ClerkProvider>/);
    expect(layout).toMatch(/<ClerkProvider>[\s\S]*<TRPCReactProvider>/);
  });
});
