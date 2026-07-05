// Task 4 (spec 009A, iteration 2/2): sign-in/sign-up catch-all routes +
// Clerk testing-token wiring for e2e. Source verification — App Router pages
// can't render in jsdom (CLAUDE.md test strategy); registration, not just
// existence.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("clerk sign-in/sign-up catch-all routes", () => {
  it("sign-in page renders <SignIn /> from @clerk/nextjs", () => {
    const page = read("src/app/sign-in/[[...sign-in]]/page.tsx");
    expect(page).toMatch(
      /import\s+\{[^}]*\bSignIn\b[^}]*\}\s+from\s+["']@clerk\/nextjs["']/,
    );
    expect(page).toMatch(/<SignIn\s*\/>/);
  });

  it("sign-up page renders <SignUp /> from @clerk/nextjs", () => {
    const page = read("src/app/sign-up/[[...sign-up]]/page.tsx");
    expect(page).toMatch(
      /import\s+\{[^}]*\bSignUp\b[^}]*\}\s+from\s+["']@clerk\/nextjs["']/,
    );
    expect(page).toMatch(/<SignUp\s*\/>/);
  });
});

describe("clerk sign-in/sign-up URL env keys", () => {
  // Presence in the env.ts schema is what forces .env.example coverage —
  // env.test.ts's superset sweep is parameterized over these schema keys.
  it.each(["NEXT_PUBLIC_CLERK_SIGN_IN_URL", "NEXT_PUBLIC_CLERK_SIGN_UP_URL"])(
    "src/env.ts schema references %s",
    (key) => {
      const envSource = read("src/env.ts");
      expect(envSource).toMatch(new RegExp(`^ {2}${key}:`, "m"));
    },
  );
});

describe("e2e Clerk testing-token wiring (no real sign-in in CI)", () => {
  it("@clerk/testing is a devDependency", () => {
    const pkg = JSON.parse(read("package.json")) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["@clerk/testing"]).toBeDefined();
  });

  it("playwright.config.ts registers the global setup", () => {
    const config = read("playwright.config.ts");
    expect(config).toMatch(/globalSetup:\s*["']\.\/e2e\/global\.setup\.ts["']/);
  });

  it("global setup obtains testing tokens via clerkSetup", () => {
    const setup = read("e2e/global.setup.ts");
    expect(setup).toMatch(
      /import\s+\{[^}]*clerkSetup[^}]*\}\s+from\s+["']@clerk\/testing\/playwright["']/,
    );
    expect(setup).toMatch(/await\s+clerkSetup\(\)/);
  });
});
