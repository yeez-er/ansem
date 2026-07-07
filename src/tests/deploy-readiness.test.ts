// Task 33 (specs 000/004/005): deploy-readiness source verification + runbook check.
// This suite owns ONLY the deploy-readiness concerns no sibling suite owns:
//   (1) the X-discovery PRE-ENABLE checklist in ralph/AGENTS.md — set the X console
//       spend cap BEFORE X_DISCOVERY_ENABLED=true (spec 005 §Context), plus the
//       documented cashtag → quoted-keyword fallback query knob;
//   (2) every `pnpm <script>` command documented in ralph/AGENTS.md is actually
//       runnable — present in package.json scripts (or a pnpm builtin) — so an
//       operator following the fresh-clone runbook never hits a missing script
//       (the "verify every documented command is runnable" nomination).
//
// Deliberately NOT duplicated (each owned elsewhere, kept single-source):
//   - exact cron paths + schedules in vercel.json → cron-refresh-metrics-route.test.ts
//     + cron-discover-x-route.test.ts
//   - .env.example ⊇ src/env.ts keys → env.test.ts superset test
//   - manual-curl cron fallback wording → db-cron-fallback.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_X_SEARCH_QUERY,
  FALLBACK_X_SEARCH_QUERY,
} from "@/server/discovery/discover-x";

const AGENTS = readFileSync("ralph/AGENTS.md", "utf8");
const PACKAGE = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};

describe("ralph/AGENTS.md: X-discovery pre-enable checklist (spec 005)", () => {
  const lower = AGENTS.toLowerCase();

  it("CONTROL: an X-discovery runbook section exists (guards the substring reads below)", () => {
    expect(AGENTS).toMatch(/X[\s-]?[Dd]iscovery/);
    expect(AGENTS.length).toBeGreaterThan(500);
  });

  it("documents the X console spend cap BEFORE the X_DISCOVERY_ENABLED=true step", () => {
    // spec 005 §Context: reads are pay-per-use; the console spend cap is the only
    // hard ceiling and MUST be set first. Pin ordering, not just co-presence.
    const capIdx = lower.indexOf("spend cap");
    const enableIdx = lower.indexOf("x_discovery_enabled=true");
    expect(capIdx).toBeGreaterThanOrEqual(0);
    expect(enableIdx).toBeGreaterThan(capIdx);
  });

  it("documents the cashtag → quoted-keyword fallback via X_SEARCH_QUERY", () => {
    expect(lower).toContain("cashtag");
    expect(AGENTS).toContain("X_SEARCH_QUERY");
  });

  it("the documented cashtag fallback is a real, distinct exported query (doc ⊆ code)", () => {
    // The runbook points operators at the fallback; it must actually exist in code
    // and differ from the default so the swap-in is meaningful, not a doc fiction.
    expect(FALLBACK_X_SEARCH_QUERY).not.toBe(DEFAULT_X_SEARCH_QUERY);
    expect(DEFAULT_X_SEARCH_QUERY).toContain("$ANSEM"); // the cashtag form
    expect(FALLBACK_X_SEARCH_QUERY).toContain('"$ANSEM"'); // the quoted-keyword fallback
  });
});

describe("ralph/AGENTS.md: every documented pnpm command is runnable (fresh-clone runbook)", () => {
  const scripts = PACKAGE.scripts ?? {};
  // pnpm's own subcommands are available without a package.json script entry.
  const PNPM_BUILTINS = new Set([
    "install",
    "add",
    "remove",
    "dlx",
    "exec",
    "run",
  ]);
  const referenced = [
    ...new Set(
      [...AGENTS.matchAll(/\bpnpm\s+([a-z][a-z0-9:-]*)/g)].map((m) => m[1]),
    ),
  ];

  it("CONTROL: the extraction found the documented pnpm commands (regex must fire)", () => {
    expect(referenced).toContain("test");
    expect(referenced).toContain("db:seed");
    expect(referenced.length).toBeGreaterThanOrEqual(5);
  });

  it.each(referenced)(
    "`pnpm %s` resolves to a package.json script or a pnpm builtin",
    (cmd) => {
      expect(
        cmd in scripts || PNPM_BUILTINS.has(cmd),
        `ralph/AGENTS.md documents \`pnpm ${cmd}\` but it is neither a package.json script nor a pnpm builtin — a fresh-clone operator following the runbook would hit a missing script`,
      ).toBe(true);
    },
  );
});
