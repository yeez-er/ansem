// Task 2 (spec 000): system.health through the REAL tRPC route handler —
// a real client with a terminating fetch that invokes the route module directly
// (exercises router, adapter, and superjson transformer, no HTTP server).
import { createTRPCClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/trpc/[trpc]/route";
import type { AppRouter } from "@/server/api/root";

const client = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: "http://test.internal/api/trpc",
      transformer: superjson,
      fetch: (input, init) =>
        GET(new Request(input as RequestInfo | URL, init as RequestInit)),
    }),
  ],
});

describe("system.health", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: new Date("2026-07-06T12:00:00Z"),
      toFake: ["Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns { ok: true, time } with time from the (pinned) clock", async () => {
    const result = await client.system.health.query();
    expect(result).toStrictEqual({
      ok: true,
      time: "2026-07-06T12:00:00.000Z",
    });
  });

  it("responds 200 JSON on the raw route handler", async () => {
    const res = await GET(
      new Request("http://test.internal/api/trpc/system.health"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("unknown procedure yields NOT_FOUND, not a crash", async () => {
    const res = await GET(
      new Request("http://test.internal/api/trpc/system.nope"),
    );
    expect(res.status).toBe(404);
    const body: unknown = await res.json();
    expect(JSON.stringify(body)).toContain('"NOT_FOUND"');
  });
});
