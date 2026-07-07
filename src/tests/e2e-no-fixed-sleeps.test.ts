// Task 31 (spec: all): source-verification guard for the "no fixed sleeps in
// e2e" acceptance criterion. Fixed delays (`page.waitForTimeout`, bare
// `setTimeout`/`sleep` used as a pause) are flaky both ways — too slow on fast
// machines, still too short on slow ones (global wisdom: "Fixed sleeps in
// end-to-end tests"). Every wait must key off an observable UI state (a row,
// text, URL, or control state), so this sweep bans the fixed-delay idioms from
// every e2e spec. Dual-layer per the "control-test your matcher" rule: prove
// the matcher fires on a deliberately-bad line before trusting the clean sweep.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const E2E_DIR = fileURLToPath(new URL("../../e2e", import.meta.url));
// Playwright writes its HTML report + traces into these dirs (gitignored
// artifacts, not specs) — never sweep generated code.
const ARTIFACT_DIRS = new Set(["report", "test-results"]);

// A fixed delay: Playwright's own `waitForTimeout`, or a bare timer/sleep used
// as a pause. Real waits use expect.poll / waitForURL / toBeVisible instead.
const FIXED_SLEEP = /waitForTimeout|\bsleep\s*\(|\bsetTimeout\s*\(/;

const walkE2eSpecs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    if (dirent.isDirectory()) {
      return ARTIFACT_DIRS.has(dirent.name)
        ? []
        : walkE2eSpecs(join(dir, dirent.name));
    }
    return /\.(ts|tsx)$/.test(dirent.name) ? [join(dir, dirent.name)] : [];
  });

describe("e2e specs contain no fixed sleeps", () => {
  it("bans waitForTimeout / setTimeout / sleep across every e2e spec (control-tested)", () => {
    // control: the matcher MUST fire on a deliberately-bad payload, else the
    // clean sweep below would be vacuously green.
    expect(FIXED_SLEEP.test("await page.waitForTimeout(500);")).toBe(true);
    expect(
      FIXED_SLEEP.test("await new Promise((r) => setTimeout(r, 250));"),
    ).toBe(true);
    // control: a real wait must NOT trip the matcher (no false positives).
    expect(FIXED_SLEEP.test("await expect(row).toBeVisible();")).toBe(false);
    expect(FIXED_SLEEP.test("await page.waitForURL(/\\/creator\\//);")).toBe(
      false,
    );

    const specs = walkE2eSpecs(E2E_DIR);
    // control: the sweep actually found spec files to scan.
    expect(specs.length).toBeGreaterThan(0);

    const offenders = specs.filter((file) =>
      FIXED_SLEEP.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
