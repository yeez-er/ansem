// Task 14 (spec 004): thin cron route for metrics refresh. All orchestration
// behavior lives in src/server/ingestion/refresh-metrics.ts (Task 13),
// integration-tested against a real DB; the shared HTTP contract
// (constant-time auth, summary line, degraded log split) lives in
// src/lib/cron-route.ts.
import { createCronHandler } from "@/lib/cron-route";
import { getDb } from "@/server/db";
import { refreshMetrics } from "@/server/ingestion/refresh-metrics";

// One Apify sync-actor sub-batch can legitimately take up to Apify's own 300s
// ceiling (Task 11) — the route budget must cover at least one full chunk.
export const maxDuration = 300;

const handleRefreshMetrics = createCronHandler({
  event: "refresh_metrics",
  run: () => refreshMetrics(getDb()),
});

// Spec 004 pins POST; Vercel Cron itself invokes cron paths with GET — one
// handler serves both so the schedule and the manual-curl fallback (Task 28)
// agree.
export { handleRefreshMetrics as GET, handleRefreshMetrics as POST };
