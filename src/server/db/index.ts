import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/env";

let db: NodePgDatabase | null = null;

// node-postgres emits an 'error' event on the Pool when an IDLE client hits a
// backend or network error (Neon dropping a pooled connection, a transient
// blip). With no listener attached, Node re-throws it as an uncaught exception
// and crashes the process — so a DB outage must be logged here, never left
// unhandled. Query-time failures instead surface through the query promise as a
// catchable rejection (handled by callers); this covers only the idle path.
export function logPoolError(err: Error): void {
  console.error(
    JSON.stringify({ event: "db.pool_error", message: err.message }),
  );
}

// Lazy singleton: importing this module must stay side-effect free so code
// paths that never touch the DB (and their tests) don't require DATABASE_URL.
export function getDb(): NodePgDatabase {
  if (db === null) {
    const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
    pool.on("error", logPoolError);
    db = drizzle({ client: pool });
  }
  return db;
}
