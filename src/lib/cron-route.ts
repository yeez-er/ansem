// Shared thin-cron-route pipeline (Tasks 14/16): constant-time auth →
// orchestrate → one structured summary line → JSON response. Extracted at the
// 2nd route (spec 005 pins "same CRON_SECRET auth as Task 14") so a fix to
// the HTTP contract can only ever land in one place.
import { getEnv } from "@/env";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export function createCronHandler<S extends object>(options: {
  event: string;
  run: () => Promise<S>;
}): (request: Request) => Promise<Response> {
  const { event, run } = options;
  return async (request) => {
    const authorized = isAuthorizedCronRequest(
      request.headers.get("authorization"),
      getEnv().CRON_SECRET,
    );
    if (!authorized) return new Response(null, { status: 401 });

    try {
      const summary = await run();
      const line = JSON.stringify({ event: `${event}.run`, ...summary });
      // Specs 004/005 guard: a degraded run still answers 200 (cron must not
      // retry-storm a struggling provider or a paid read cap) but logs at
      // error level.
      if (isDegraded(summary)) console.error(line);
      else console.info(line);
      return Response.json(summary);
    } catch (err) {
      // The DB is an external service — a dead connection must surface as a
      // structured 500, never an unhandled rejection.
      console.error(
        JSON.stringify({
          event: `${event}.failed`,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return Response.json({ ok: false }, { status: 500 });
    }
  };
}

// A summary without a `degraded` key (e.g. discovery's `{ skipped: true }`)
// is never degraded.
function isDegraded(summary: object): boolean {
  return (
    "degraded" in summary &&
    (summary as { degraded?: unknown }).degraded === true
  );
}
