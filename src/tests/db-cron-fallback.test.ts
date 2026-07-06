// @vitest-environment node
// Task 28 (specs 000/004/005): external-service fallback verification for the
// Neon Postgres + Vercel Cron rows of ralph/AGENTS.md. This file owns the two
// DB-outage runtime contracts:
//   (1) an IDLE pg-client error is handled, never crashing the process, and
//   (2) a query against an unreachable DATABASE_URL surfaces a readable, typed,
//       CATCHABLE error (no unhandled rejection);
// plus source-verification that AGENTS.md documents the manual-curl cron
// fallback and that its External Services rows name the real env vars.
//
// The sibling legs of the acceptance criteria are already owned elsewhere and
// deliberately NOT duplicated here: env.ts's boot fast-fail on a MALFORMED
// DATABASE_URL is env.test.ts, and the seed CLI's exit-1 on an unreachable DB
// is seed.test.ts. Cron auth (401 on a bad secret) is the route suites.
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseServerEnv } from "@/env";
import { logPoolError } from "@/server/db";

// A syntactically valid postgres URL pointed at a closed local port: env.ts's
// format gate accepts it, so the failure can only surface at connect time.
const UNREACHABLE_DB_URL = "postgresql://nobody:nobody@127.0.0.1:9/nowhere";

describe("db pool: an idle-client error is handled, never crashes the process", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("CONTROL: a fresh pg Pool has no 'error' listener, so an idle error WOULD throw (the crash we prevent)", async () => {
    const pool = new Pool({ connectionString: UNREACHABLE_DB_URL });
    try {
      expect(pool.listenerCount("error")).toBe(0);
      expect(() => pool.emit("error", new Error("idle client boom"))).toThrow(
        "idle client boom",
      );
    } finally {
      await pool.end();
    }
  });

  it("logPoolError logs exactly ONE structured line and never throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      logPoolError(new Error("connection terminated unexpectedly")),
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toStrictEqual({
      event: "db.pool_error",
      message: "connection terminated unexpectedly",
    });
  });

  it("with logPoolError attached, an emitted idle error is swallowed + logged (no throw)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = new Pool({ connectionString: UNREACHABLE_DB_URL });
    pool.on("error", logPoolError);
    try {
      expect(() =>
        pool.emit("error", new Error("neon dropped idle client")),
      ).not.toThrow();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(errorSpy.mock.calls[0][0] as string)).toMatchObject({
        event: "db.pool_error",
      });
    } finally {
      await pool.end();
    }
  });

  it("source: getDb wires pool.on('error', logPoolError) so the handler can't be silently dropped", () => {
    const DB_SOURCE = readFileSync("src/server/db/index.ts", "utf8");
    expect(DB_SOURCE).toMatch(/\.on\(\s*["']error["']\s*,\s*logPoolError\s*\)/);
  });
});

describe("DATABASE_URL unreachable → a query rejects with a readable typed error (no unhandled rejection)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("env.ts's format gate accepts a valid-but-unreachable URL — reachability is a runtime concern, not a boot one", () => {
    expect(
      parseServerEnv({ DATABASE_URL: UNREACHABLE_DB_URL }).DATABASE_URL,
    ).toBe(UNREACHABLE_DB_URL);
  });

  it("getDb() query against the unreachable URL rejects with a catchable ECONNREFUSED error", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", UNREACHABLE_DB_URL);
    const { getDb } = await import("@/server/db");
    const db = getDb();
    try {
      // .catch(e => e) always captures the outcome — a bare `await` would make
      // this a vacuous negative if the query somehow resolved.
      const outcome = await db.execute(sql`select 1`).catch((e: unknown) => e);
      expect(outcome).toBeInstanceOf(Error);
      const err = outcome as Error & { cause?: { code?: string } };
      // A VALID query that fails ⇒ the failure is the connection, and the
      // cause names it: a readable, typed signal, never a raw crash.
      expect(err.message).toContain("select 1");
      expect(err.cause?.code).toBe("ECONNREFUSED");
    } finally {
      // $client is the underlying pg Pool at runtime; drizzle's public type
      // doesn't surface it, so cast to reach .end() for a clean teardown.
      await (db as unknown as { $client: Pool }).$client.end();
    }
  });
});

describe("ralph/AGENTS.md documents the DB + cron fallbacks (rows match reality)", () => {
  const AGENTS = readFileSync("ralph/AGENTS.md", "utf8");
  const ENV_SOURCE = readFileSync("src/env.ts", "utf8");
  const VERCEL = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  const CRON_PATHS = [
    "/api/cron/refresh-metrics",
    "/api/cron/discover-x",
  ] as const;

  it("CONTROL: the External Services section is present (guards the substring reads below)", () => {
    expect(AGENTS).toContain("External Services");
    expect(AGENTS.length).toBeGreaterThan(500);
  });

  it("documents a manual bearer-auth curl fallback for BOTH cron routes", () => {
    expect(AGENTS).toMatch(/curl[^\n]*Authorization: Bearer \$CRON_SECRET/);
    for (const path of CRON_PATHS) {
      expect(
        AGENTS.includes(path),
        `AGENTS.md must document a manual curl for ${path}`,
      ).toBe(true);
    }
  });

  it("every documented cron path is actually registered in vercel.json (doc ⊆ reality)", () => {
    const registered = new Set((VERCEL.crons ?? []).map((c) => c.path));
    for (const path of CRON_PATHS) {
      expect(
        registered.has(path),
        `${path} documented but missing from vercel.json crons`,
      ).toBe(true);
    }
  });

  it("External Services rows name the real env vars for Neon + Vercel Cron, and those vars exist in src/env.ts", () => {
    for (const marker of [
      "Neon Postgres",
      "DATABASE_URL",
      "Vercel Cron",
      "CRON_SECRET",
    ]) {
      expect(
        AGENTS.includes(marker),
        `AGENTS.md External Services must mention ${marker}`,
      ).toBe(true);
    }
    expect(ENV_SOURCE).toContain("DATABASE_URL");
    expect(ENV_SOURCE).toContain("CRON_SECRET");
  });
});
