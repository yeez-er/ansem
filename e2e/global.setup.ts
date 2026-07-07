// Task 4 (spec 009A): mint a Clerk testing token once per e2e run so
// signed-in flows (Tasks 24/26) never script a real sign-in in CI.
// Task 22 (spec 008): load the idempotent story seed (spec 010) so board
// specs have deterministic data.
import { execSync } from "node:child_process";
import { clerkSetup } from "@clerk/testing/playwright";

// The Playwright process does not load Next's dotenv files; the dev server
// does. Load .env.local here so clerkSetup sees the same keys.
function loadLocalEnv() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local (e.g. CI injects real env) — nothing to load
  }
}

// The DB is an external service: a migrate/seed failure must not kill the
// specs that never touch it (health, auth-gate, smoke) — warn loudly and let
// board.spec fail with this context in the output. Both steps are idempotent
// (drizzle journal / spec-010 natural-key upserts), so re-runs are safe.
// drizzle.config.ts reads DATABASE_URL from the process env, which
// loadLocalEnv() has already populated and execSync inherits.
function migrateAndSeedDatabase() {
  try {
    execSync("pnpm db:migrate", { stdio: "pipe", timeout: 120_000 });
    execSync("pnpm db:seed", { stdio: "pipe", timeout: 120_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(
      `[e2e] db:migrate/db:seed failed — board.spec.ts needs seeded story data and will fail.\n${detail}`,
    );
  }
}

export default async function globalSetup() {
  loadLocalEnv();
  migrateAndSeedDatabase();
  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  // The tracked placeholder key (clerk.example.com) cannot mint testing
  // tokens — signed-out gate specs still run; signed-in specs need real
  // pk_test_/sk_test_ keys.
  if (!secretKey || secretKey.endsWith("_placeholder")) return;
  await clerkSetup();
}
