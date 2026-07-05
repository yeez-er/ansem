// Task 16 (spec 005): thin cron route for X discovery. All orchestration
// behavior lives in src/server/discovery/discover-x.ts, integration-tested
// against a real DB; the shared HTTP contract (constant-time auth, summary
// line, degraded log split) lives in src/lib/cron-route.ts.
import { createCronHandler } from "@/lib/cron-route";
import { getDb } from "@/server/db";
import { discoverX } from "@/server/discovery/discover-x";

// A full run is up to 3 paid search pages plus one transaction per result
// (≤ 300) — the budget must outlast the write loop, or reads salvaged from a
// degraded run get killed mid-persist and their spend is wasted.
export const maxDuration = 300;

const handleDiscoverX = createCronHandler({
  event: "discover_x",
  run: () => discoverX(getDb()),
});

// Spec 005 pins POST; Vercel Cron itself invokes cron paths with GET — one
// handler serves both so the schedule and the manual-curl fallback (Task 28)
// agree.
export { handleDiscoverX as GET, handleDiscoverX as POST };
