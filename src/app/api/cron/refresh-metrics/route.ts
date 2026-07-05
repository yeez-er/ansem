// Task 14 (spec 004): thin cron route — auth + refreshMetrics() + one
// structured summary line. All orchestration behavior lives in
// src/server/ingestion/refresh-metrics.ts (Task 13), integration-tested
// against a real DB; this handler owns only the HTTP contract.
import { getEnv } from "@/env";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { getDb } from "@/server/db";
import { refreshMetrics } from "@/server/ingestion/refresh-metrics";

// One Apify sync-actor sub-batch can legitimately take up to Apify's own 300s
// ceiling (Task 11) — the route budget must cover at least one full chunk.
export const maxDuration = 300;

async function handleRefreshMetrics(request: Request): Promise<Response> {
  const authorized = isAuthorizedCronRequest(
    request.headers.get("authorization"),
    getEnv().CRON_SECRET,
  );
  if (!authorized) return new Response(null, { status: 401 });

  try {
    const summary = await refreshMetrics(getDb());
    const line = JSON.stringify({ event: "refresh_metrics.run", ...summary });
    // Spec 004 guard: a degraded run still answers 200 (cron must not
    // retry-storm a struggling provider) but logs at error level.
    if (summary.degraded) console.error(line);
    else console.info(line);
    return Response.json(summary);
  } catch (err) {
    // The DB is an external service — a dead connection must surface as a
    // structured 500, never an unhandled rejection.
    console.error(
      JSON.stringify({
        event: "refresh_metrics.failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return Response.json({ ok: false }, { status: 500 });
  }
}

// Spec 004 pins POST; Vercel Cron itself invokes cron paths with GET — one
// handler serves both so the schedule and the manual-curl fallback (Task 28)
// agree.
export { handleRefreshMetrics as GET, handleRefreshMetrics as POST };
