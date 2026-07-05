// Shared harness for integration tests that hit a REAL test database.
// Consumer files MUST carry `// @vitest-environment node`. The target database
// is dropped and re-migrated per suite, so TEST_DATABASE_URL must point at a
// DEDICATED test DB — never the dev DB. vitest.config.ts disables file
// parallelism so DB test files never race each other on this database.
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export type TestDb = { pool: Pool; db: NodePgDatabase };

export function connectTestDb(): TestDb {
  try {
    process.loadEnvFile(".env.local"); // local dev; CI injects env directly
  } catch {
    // .env.local absent — env must already be in the process
  }

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is required for DB integration tests — point it at a DEDICATED test database (it gets wiped), never at the dev DB.",
    );
  }
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must differ from DATABASE_URL — these tests wipe the target database.",
    );
  }

  const pool = new Pool({ connectionString: url });
  return { pool, db: drizzle({ client: pool }) };
}

// Fresh database: drop the app schema AND drizzle's migration bookkeeping so
// `migrate` provably applies the full migration chain from zero.
export async function migrateFresh({ pool, db }: TestDb): Promise<void> {
  await pool.query('drop schema if exists "public" cascade');
  await pool.query('drop schema if exists "drizzle" cascade');
  await pool.query('create schema "public"');
  await migrate(db, { migrationsFolder: "drizzle" });
}

export async function truncateAll(db: NodePgDatabase): Promise<void> {
  await db.execute(
    sql`truncate table "creators", "posts", "metric_snapshots" cascade`,
  );
}

// drizzle wraps driver errors (DrizzleQueryError); the pg DatabaseError with
// `code`/`constraint` rides on `.cause`.
export function pgError(err: unknown): unknown {
  return err instanceof Error && err.cause !== undefined ? err.cause : err;
}
