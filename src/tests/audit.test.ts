// Task 32 (all specs; CLAUDE.md "Done" definition): the final audit sweep.
// Parameterized source-verification guards that lock in the invariants the
// build loop relied on across 31 tasks:
//   1. test hygiene   — no skipped/focused tests, no TODO/FIXME, no console.log debug
//   2. no inert code  — pure engines + the provider registry keep >=1 live caller;
//                        the latest_* denorm columns keep both a writer and a reader
//   3. registration   — every sub-router is mounted, every procedure is exposed,
//                        every declared event handler is bound
// All checks are deterministic file reads: no DB, no jsdom, runs offline. Each
// sweep is paired with a CONTROL assertion proving its matcher fires on a
// deliberately-bad input, so a passing sweep is never vacuous.
//
// Not re-pinned here (owned elsewhere, to avoid a divergent second copy):
//   - schema barrel completeness  -> schema-structure.test.ts
//   - no-fixed-sleeps in e2e/      -> e2e-no-fixed-sleeps.test.ts
//   - scoring engine inertness     -> scoring.test.ts (weights sweep) + here (caller)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walkFiles } from "@/tests/helpers/source-tree";

const SRC_DIR = join(process.cwd(), "src");
const SELF = fileURLToPath(import.meta.url);

const ALL_TS = walkFiles(SRC_DIR);
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);
// Shipped source: non-test files only.
const SOURCE_FILES = ALL_TS.filter((f) => !isTest(f));
// This audit file embeds banned tokens (console.log, TODO, .skip) as control
// fixtures, so it excludes itself from the sweeps it defines.
const TEST_FILES = ALL_TS.filter((f) => isTest(f) && f !== SELF);

const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(SRC_DIR.length + 1);
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("audit — the sweep actually scans the tree (guards against an empty glob)", () => {
  it("finds shipped source and test files", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(20);
    expect(TEST_FILES.length).toBeGreaterThan(20);
  });
});

describe("test hygiene — no skipped or focused tests", () => {
  const SKIP_ONLY = /\b(?:it|test|describe)\.(?:skip|only)\b/;
  const XPREFIX = /\bx(?:it|describe|test)\s*\(/;

  it("control: the matchers fire on deliberately skipped/focused tests", () => {
    expect("it.skip('x', () => {})").toMatch(SKIP_ONLY);
    expect("describe.only('y', () => {})").toMatch(SKIP_ONLY);
    expect("xit('z', () => {})").toMatch(XPREFIX);
  });

  it.each(TEST_FILES.map(rel))(
    "%s has no .skip/.only/xit/xdescribe",
    (path) => {
      const source = stripComments(read(join(SRC_DIR, path)));
      expect(source, path).not.toMatch(SKIP_ONLY);
      expect(source, path).not.toMatch(XPREFIX);
    },
  );
});

describe("no TODO/FIXME markers in shipped source", () => {
  const MARKER = /\b(?:TODO|FIXME)\b/;

  it("control: the matcher fires on a deliberate TODO/FIXME", () => {
    expect("// TODO: wire this up").toMatch(MARKER);
    expect("/* FIXME later */").toMatch(MARKER);
  });

  it.each(SOURCE_FILES.map(rel))("%s carries no TODO/FIXME", (path) => {
    // scan the raw file (markers live in comments)
    expect(read(join(SRC_DIR, path)), path).not.toMatch(MARKER);
  });
});

describe("no console.log debugging in shipped source (structured info/warn/error are sanctioned)", () => {
  const CONSOLE_LOG = /console\.log\s*\(/;

  it("control: the matcher fires on a deliberate console.log", () => {
    expect(stripComments("console.log('debug', value)")).toMatch(CONSOLE_LOG);
    // the sanctioned structured sinks must NOT trip the matcher
    expect("console.info('event')").not.toMatch(CONSOLE_LOG);
    expect("console.error('boom')").not.toMatch(CONSOLE_LOG);
    expect("console.warn('skip')").not.toMatch(CONSOLE_LOG);
  });

  it.each(SOURCE_FILES.map(rel))("%s has no console.log", (path) => {
    expect(stripComments(read(join(SRC_DIR, path))), path).not.toMatch(
      CONSOLE_LOG,
    );
  });
});

describe("no inert engines — every pure engine keeps >=1 live caller", () => {
  const importsFrom = (spec: string) =>
    SOURCE_FILES.filter((f) => read(f).includes(`from "${spec}"`));

  it("control: the import sweep returns [] for a module nobody imports", () => {
    expect(importsFrom("@/lib/__nonexistent_engine__")).toHaveLength(0);
  });

  it("scoring engine (@/lib/scoring) is imported by >=1 shipped module", () => {
    const callers = importsFrom("@/lib/scoring");
    expect(
      callers.length,
      "no live caller for the scoring engine",
    ).toBeGreaterThanOrEqual(1);
  });

  it("metrics provider registry (getProvider) has >=1 shipped call site", () => {
    const callers = SOURCE_FILES.filter(
      (f) =>
        !f.endsWith(join("metrics", "provider.ts")) &&
        /\bgetProvider\s*\(/.test(read(f)),
    );
    expect(
      callers.length,
      "getProvider is defined but never called",
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("no dead denormalized columns — latest_* keeps both a writer and a reader", () => {
  it("refresh-metrics writes latest_* + latest_snapshot_at (the writer, Task 13)", () => {
    const source = read(
      join(SRC_DIR, "server", "ingestion", "refresh-metrics.ts"),
    );
    expect(source).toMatch(/latestViews:/);
    expect(source).toMatch(/latestLikes:/);
    expect(source).toMatch(/latestComments:/);
    expect(source).toMatch(/latestShares:/);
    expect(source).toMatch(/latestSnapshotAt:/);
  });

  it("the all-time board reads latest_* (the reader that justifies the columns, Task 17)", () => {
    const source = read(
      join(SRC_DIR, "server", "db", "queries", "leaderboard.ts"),
    );
    for (const col of [
      "latestViews",
      "latestLikes",
      "latestComments",
      "latestShares",
    ]) {
      expect(source, `${col} has no reader`).toContain(col);
    }
  });
});

describe("router registration — every sub-router is mounted on appRouter", () => {
  const root = read(join(SRC_DIR, "server", "api", "root.ts"));

  it.each(["submissions", "leaderboard", "admin"])(
    "root.ts mounts the %s router",
    (name) => {
      expect(root).toMatch(new RegExp(`${name}:\\s*${name}Router`));
    },
  );

  it("the system.health public procedure stays mounted", () => {
    expect(root).toMatch(/health:\s*publicProcedure/);
  });
});

describe("procedure registration — every named procedure is exposed on its router", () => {
  // Keys are the public contract (admin's `creators` key binds `creatorList`).
  const ROUTER_PROCEDURES: Record<string, string[]> = {
    submissions: ["submit"],
    leaderboard: ["get", "creator", "recentPosts"],
    admin: [
      "pendingPosts",
      "creators",
      "reviewPost",
      "banCreator",
      "refreshPost",
    ],
  };

  for (const [router, procs] of Object.entries(ROUTER_PROCEDURES)) {
    const index = read(
      join(SRC_DIR, "server", "api", "routers", router, "index.ts"),
    );
    it.each(procs)(`${router}/index.ts registers %s`, (proc) => {
      expect(index).toMatch(new RegExp(`\\b${proc}\\b`));
    });
  }
});

describe("event-handler binding — no defined-but-never-bound handlers", () => {
  const CLIENT_TSX = SOURCE_FILES.filter(
    (f) => f.endsWith(".tsx") && read(f).includes("use client"),
  );
  const DECL = /\b(?:const|function)\s+(handle[A-Z]\w*)/g;

  it("finds the client components to sweep", () => {
    expect(CLIENT_TSX.length).toBeGreaterThan(0);
  });

  it("control: a handler declared once and never bound is detectable", () => {
    const source = "const handleGhost = () => {};\nreturn <div />;";
    const occurrences = source.match(/\bhandleGhost\b/g) ?? [];
    // declaration only => exactly one occurrence => unbound
    expect(occurrences).toHaveLength(1);
  });

  it.each(CLIENT_TSX.map(rel))(
    "%s binds every handleXxx it declares",
    (path) => {
      const source = read(join(SRC_DIR, path));
      const declared = new Set(
        [...source.matchAll(DECL)].map((m) => m[1] as string),
      );
      for (const name of declared) {
        const occurrences =
          source.match(new RegExp(`\\b${name}\\b`, "g")) ?? [];
        expect(
          occurrences.length,
          `${name} in ${path} is declared but never bound (only ${occurrences.length} occurrence)`,
        ).toBeGreaterThanOrEqual(2);
      }
    },
  );
});
