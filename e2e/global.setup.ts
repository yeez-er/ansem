// Task 4 (spec 009A): mint a Clerk testing token once per e2e run so
// signed-in flows (Tasks 24/26) never script a real sign-in in CI.
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

export default async function globalSetup() {
	loadLocalEnv();
	const secretKey = process.env.CLERK_SECRET_KEY ?? "";
	// The tracked placeholder key (clerk.example.com) cannot mint testing
	// tokens — signed-out gate specs still run; signed-in specs need real
	// pk_test_/sk_test_ keys.
	if (!secretKey || secretKey.endsWith("_placeholder")) return;
	await clerkSetup();
}
