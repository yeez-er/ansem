// Task 24 (spec 008): source verification for the submit page — App Router
// server components can't render in jsdom (CLAUDE.md test strategy). Pin the
// signed-out gate (Clerk <Show> + exact copy), the form handoff, and —
// critically — that the client form reuses the SHARED parsePostUrl (no
// duplicated parser copy). Also pins the proxy change that makes /submit
// publicly reachable so the in-page gate is never dead code.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const page = read("./page.tsx");
const form = read("./submit-form.tsx");
const proxy = read("../../../proxy.ts");

describe("submit page — signed-out gate", () => {
  it("gates signed-out visitors with Clerk <Show when='signed-out'>", () => {
    expect(page).toMatch(/<Show\b[^>]*when=["']signed-out["']/);
  });

  it("shows the exact sign-in copy and a Clerk SignInButton", () => {
    expect(page).toContain("Sign in to submit posts.");
    expect(page).toMatch(
      /import\s+\{[^}]*\bSignInButton\b[^}]*\}\s+from\s+["']@clerk\/nextjs["']/,
    );
    expect(page).toContain("<SignInButton");
  });

  it("hands signed-in visitors to the client SubmitForm", () => {
    expect(page).toContain("<SubmitForm");
  });
});

describe("submit form — shared parser, no duplicated client copy", () => {
  it("imports parsePostUrl from the shared lib", () => {
    expect(form).toMatch(
      /import\s+\{[^}]*\bparsePostUrl\b[^}]*\}\s+from\s+["']@\/lib\/post-url["']/,
    );
  });

  it("does not re-implement the platform host switch in the client", () => {
    // single source of truth is src/lib/post-url.ts
    expect(form).not.toContain('"x.com"');
    expect(form).not.toContain("instagram.com");
  });

  it("reuses the shared PlatformBadge for the detect chip", () => {
    expect(form).toMatch(
      /import\s+\{[^}]*\bPlatformBadge\b[^}]*\}\s+from\s+["']@\/components\/platform-badge["']/,
    );
  });
});

describe("proxy — /submit is publicly reachable, /admin still gated", () => {
  it("createRouteMatcher covers /admin but not /submit", () => {
    const match = proxy.match(/createRouteMatcher\(\[([^\]]*)\]\)/);
    expect(match).not.toBeNull();
    const routes = match?.[1] ?? "";
    expect(routes).toContain("/admin");
    expect(routes).not.toContain("/submit");
  });
});
