// Task 3 (spec 001): source verification — schema module registration in the
// barrel and generated-migration structure (constraints, indexes, bigint,
// cascade). Runtime behavior of the same constraints is covered in
// schema-runtime.test.ts (dual-layer testing).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCHEMA_DIR = join(process.cwd(), "src", "server", "db", "schema");
const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

const EXPECTED_MODULES = ["enums", "creators", "posts", "metric-snapshots"];

function schemaModuleFiles(): string[] {
  return readdirSync(SCHEMA_DIR).filter(
    (f) => f.endsWith(".ts") && f !== "index.ts" && !f.endsWith(".test.ts"),
  );
}

function readBarrel(): string {
  return readFileSync(join(SCHEMA_DIR, "index.ts"), "utf8");
}

function readMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

describe("schema barrel (registration, not just existence)", () => {
  it.each(EXPECTED_MODULES)("index.ts re-exports ./%s", (mod) => {
    expect(readBarrel()).toMatch(
      new RegExp(`export \\* from ["']\\./${mod}["']`),
    );
  });

  it("every schema module in the directory is re-exported (sweep)", () => {
    const modules = schemaModuleFiles();
    expect(modules.length).toBeGreaterThanOrEqual(EXPECTED_MODULES.length);
    const barrel = readBarrel();
    for (const file of modules) {
      const mod = file.replace(/\.ts$/, "");
      expect(barrel).toMatch(new RegExp(`export \\* from ["']\\./${mod}["']`));
    }
  });
});

describe("generated migration (ORM metadata without a migration is documentation, not enforcement)", () => {
  it.each([
    ["platform", ["x", "tiktok", "instagram"]],
    ["post_status", ["pending", "approved", "rejected", "removed"]],
    ["post_source", ["submission", "x_search", "admin"]],
  ] as const)("creates enum %s with the exact spec values", (name, values) => {
    const list = values.map((v) => `'${v}'`).join(",\\s*");
    expect(readMigrationSql()).toMatch(
      new RegExp(`CREATE TYPE "public"\\."${name}" AS ENUM\\(${list}\\)`),
    );
  });

  it.each([
    ["creators_platform_handle_unique", '"platform"\\s*,\\s*"handle"'],
    [
      "posts_platform_platform_post_id_unique",
      '"platform"\\s*,\\s*"platform_post_id"',
    ],
  ])("declares UNIQUE constraint %s (natural upsert key)", (name, cols) => {
    expect(readMigrationSql()).toMatch(
      new RegExp(`CONSTRAINT "${name}" UNIQUE\\s*\\(${cols}\\)`),
    );
  });

  it.each([
    ["posts_status_platform_idx", "posts", '"status"\\s*,\\s*"platform"'],
    ["posts_creator_id_idx", "posts", '"creator_id"'],
    [
      "metric_snapshots_post_id_captured_at_idx",
      "metric_snapshots",
      '"post_id"\\s*,\\s*"captured_at"\\s+DESC',
    ],
  ])("creates index %s", (name, table, cols) => {
    expect(readMigrationSql()).toMatch(
      new RegExp(`CREATE INDEX "${name}" ON "${table}"[^;]*\\(${cols}`, "i"),
    );
  });

  it("no explicit index duplicates a UNIQUE constraint's implicit index (exactly 3 indexes)", () => {
    const stmts =
      readMigrationSql().match(/CREATE (?:UNIQUE )?INDEX[^;]+/gi) ?? [];
    expect(stmts).toHaveLength(3);
    for (const stmt of stmts) {
      expect(stmt).not.toMatch(/\("platform"\s*,\s*"handle"\)/);
      expect(stmt).not.toMatch(/\("platform"\s*,\s*"platform_post_id"\)/);
    }
  });

  it.each([
    ["posts", "latest_views"],
    ["posts", "latest_likes"],
    ["posts", "latest_comments"],
    ["posts", "latest_shares"],
    ["metric_snapshots", "views"],
    ["metric_snapshots", "likes"],
    ["metric_snapshots", "comments"],
    ["metric_snapshots", "shares"],
  ])("%s.%s is bigint (X view counts overflow int4)", (table, column) => {
    expect(readMigrationSql()).toMatch(
      new RegExp(
        `CREATE TABLE (?:"public"\\.)?"${table}"[^;]*"${column}" bigint`,
        "i",
      ),
    );
  });

  it("metric_snapshots.post_id FK cascade-deletes with its post", () => {
    expect(readMigrationSql()).toMatch(
      /ALTER TABLE (?:"public"\.)?"metric_snapshots"[^;]*FOREIGN KEY \("post_id"\)[^;]*ON DELETE cascade/i,
    );
  });

  it("has no speculative claimed_by_user_id column (deliberately CUT from v1)", () => {
    expect(readMigrationSql()).not.toMatch(/claimed_by_user_id/);
    for (const file of schemaModuleFiles()) {
      expect(readFileSync(join(SCHEMA_DIR, file), "utf8")).not.toMatch(
        /claimedByUserId|claimed_by_user_id/,
      );
    }
  });
});
