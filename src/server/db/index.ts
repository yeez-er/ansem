import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/env";

let db: NodePgDatabase | null = null;

// Lazy singleton: importing this module must stay side-effect free so code
// paths that never touch the DB (and their tests) don't require DATABASE_URL.
export function getDb(): NodePgDatabase {
  db ??= drizzle({
    client: new Pool({ connectionString: getEnv().DATABASE_URL }),
  });
  return db;
}
