// @vitest-environment node
// Source verification for spec 000 / Task 1: docs may not drift from runnable scripts,
// and .gitignore must actually ignore what it claims to.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("ralph/AGENTS.md scripts exist in package.json", () => {
  const agentsMd = readFileSync(join(root, "ralph", "AGENTS.md"), "utf8");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  // pnpm subcommands that are not package.json scripts
  const PNPM_BUILTINS = new Set([
    "install",
    "create",
    "dlx",
    "add",
    "exec",
    "run",
  ]);
  const scriptNames = [
    ...new Set(
      [...agentsMd.matchAll(/pnpm ([a-z0-9:_-]+)/g)]
        .map((m) => m[1])
        .filter((name) => !PNPM_BUILTINS.has(name)),
    ),
  ];

  it("extraction found the documented scripts (control test — regex must fire)", () => {
    expect(scriptNames.length).toBeGreaterThanOrEqual(7);
    expect(scriptNames).toContain("dev");
    expect(scriptNames).toContain("test");
  });

  it.each(scriptNames)("script %s exists in package.json scripts", (name) => {
    expect(
      pkg.scripts?.[name],
      `ralph/AGENTS.md documents \`pnpm ${name}\` but package.json has no such script`,
    ).toBeDefined();
  });
});

describe(".gitignore coverage", () => {
  const isIgnored = (path: string): boolean => {
    try {
      execSync(`git check-ignore -q -- "${path}"`, { cwd: root });
      return true;
    } catch (error) {
      // exit 1 = "not ignored"; anything else (e.g. 128 "beyond a symbolic link")
      // is a broken probe and must fail loudly, not report false
      if ((error as { status?: number }).status === 1) return false;
      throw error;
    }
  };

  it("matcher fires on a known-ignored path and stays silent on tracked source (control test)", () => {
    expect(isIgnored(".ralph-logs/anything.log")).toBe(true);
    expect(isIgnored("ralph/AGENTS.md")).toBe(false);
  });

  it.each([
    ".env",
    ".env.local",
    ".env.production",
    ".next/BUILD_ID",
    "node_modules/probe.js",
    "e2e/test-results/trace.zip",
    "e2e/report/index.html",
  ])("ignores %s", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it("does not ignore .env.example (placeholders must be committed)", () => {
    expect(isIgnored(".env.example")).toBe(false);
  });
});
