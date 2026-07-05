// Task 16 iteration 2 (spec 005): /api/cron/discover-x route. The route is
// thin — auth + discoverX() + one structured summary line — so orchestration
// is mocked here (its behavior is discover-x.test.ts's real-DB suite); these
// tests own the HTTP contract: the auth matrix over BOTH exported methods
// (spec pins POST; Vercel Cron itself invokes cron paths with GET), the
// summary response for run/skipped/degraded, the log level split, and source
// verification for the timing-safe compare, the hourly vercel.json cron
// entry, and the discoverX ≥1-live-caller inertness check.
import { readFileSync } from "node:fs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import type { DiscoverySummary } from "@/server/discovery/discover-x";

const SECRET = "cron-secret-for-discover-x-route-tests";

const state = vi.hoisted(() => ({
  cronSecret: undefined as string | undefined,
}));
const discoverXMock = vi.hoisted(() => vi.fn());
const FAKE_DB = vi.hoisted(() => ({ fake: "db" }));

vi.mock("@/env", () => ({
  getEnv: () => ({ CRON_SECRET: state.cronSecret }),
}));
vi.mock("@/server/db", () => ({ getDb: () => FAKE_DB }));
vi.mock("@/server/discovery/discover-x", () => ({
  discoverX: discoverXMock,
}));

import { GET, maxDuration, POST } from "@/app/api/cron/discover-x/route";

const SUMMARY: DiscoverySummary = {
  skipped: false,
  pagesRead: 2,
  postsRead: 180,
  discovered: 150,
  duplicates: 25,
  banned: 3,
  invalid: 2,
  errors: 0,
  truncated: false,
  degraded: false,
  cursorAdvanced: true,
  durationMs: 1234,
};

function request(method: string, authorization?: string): Request {
  return new Request("http://test.internal/api/cron/discover-x", {
    method,
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe.each([
  ["GET", GET],
  ["POST", POST],
] as const)("%s /api/cron/discover-x", (method, handler) => {
  let infoSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    state.cronSecret = SECRET;
    discoverXMock.mockReset().mockResolvedValue(SUMMARY);
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["no Authorization header", undefined],
    ["a wrong bearer secret", `Bearer ${SECRET}x`],
    ["the raw secret without the Bearer scheme", SECRET],
  ])(
    "%s → 401 with an EMPTY body, orchestration never runs",
    async (_label, authorization) => {
      const res = await handler(request(method, authorization));
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
      expect(discoverXMock).not.toHaveBeenCalled();
    },
  );

  it("fails closed when CRON_SECRET is unset — even `Bearer undefined` is 401", async () => {
    state.cronSecret = undefined;
    const res = await handler(request(method, "Bearer undefined"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(discoverXMock).not.toHaveBeenCalled();
  });

  it("valid secret → 200 with the summary + exactly one structured info line", async () => {
    const res = await handler(request(method, `Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual(SUMMARY);
    expect(discoverXMock).toHaveBeenCalledTimes(1);
    expect(discoverXMock).toHaveBeenCalledWith(FAKE_DB);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line).toStrictEqual({ event: "discover_x.run", ...SUMMARY });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("flag-off run ({ skipped: true }) → 200 + info line, never an error", async () => {
    const skipped: DiscoverySummary = { skipped: true };
    discoverXMock.mockResolvedValue(skipped);

    const res = await handler(request(method, `Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual(skipped);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line).toStrictEqual({ event: "discover_x.run", skipped: true });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("degraded run (429/transport abort) → still 200 (no retry-storm) but logged at ERROR level", async () => {
    const degraded: DiscoverySummary = {
      ...SUMMARY,
      pagesRead: 1,
      degraded: true,
      cursorAdvanced: false,
    };
    discoverXMock.mockResolvedValue(degraded);

    const res = await handler(request(method, `Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual(degraded);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toStrictEqual({ event: "discover_x.run", ...degraded });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("orchestration rejection (e.g. DB unreachable) → 500 + structured error, no unhandled rejection", async () => {
    discoverXMock.mockRejectedValue(new Error("connection refused"));

    const res = await handler(request(method, `Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    expect(await res.json()).toStrictEqual({ ok: false });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toStrictEqual({
      event: "discover_x.failed",
      message: "connection refused",
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("source verification", () => {
  const ROUTE_SOURCE = readFileSync(
    "src/app/api/cron/discover-x/route.ts",
    "utf8",
  );
  const PIPELINE_SOURCE = readFileSync("src/lib/cron-route.ts", "utf8");

  // Flags an equality operator touching the secret (or a `Bearer …` template)
  // — the timing-oracle pattern specs 004/005 ban.
  const NAIVE_COMPARE =
    /(?:[=!]==\s*`Bearer )|(?:`\s*[=!]==)|(?:secret\s*[=!]==)|(?:[=!]==\s*[\w.]*secret)/i;

  // CONTROL: prove the matcher fires on the naive patterns before trusting
  // its negative below (an undemonstrated security matcher is vacuous).
  it.each([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source-code sample for the matcher
    "if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source-code sample for the matcher
    "if (header === `Bearer ${secret}`) {",
    "if (secret === provided) {",
    "if (provided === env.CRON_SECRET) {",
  ])("control: naive-compare matcher fires on %s", (naiveLine) => {
    expect(NAIVE_COMPARE.test(naiveLine)).toBe(true);
  });

  it("route delegates to the shared cron pipeline, which owns the constant-time auth — no === on the secret", () => {
    expect(ROUTE_SOURCE).toContain("createCronHandler(");
    expect(PIPELINE_SOURCE).toContain("isAuthorizedCronRequest(");
    expect(NAIVE_COMPARE.test(ROUTE_SOURCE)).toBe(false);
    expect(NAIVE_COMPARE.test(PIPELINE_SOURCE)).toBe(false);
  });

  it("route pins maxDuration so salvaged paid reads survive the write loop", () => {
    // Next.js statically analyzes the export — it must be a literal.
    expect(ROUTE_SOURCE).toContain("export const maxDuration = 300");
    expect(maxDuration).toBe(300);
  });

  it("vercel.json registers the hourly cron on the exact route path", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toContainEqual({
      path: "/api/cron/discover-x",
      schedule: "0 * * * *",
    });
  });

  it("discoverX has a live caller: the cron route invokes the orchestration (inertness check)", () => {
    expect(ROUTE_SOURCE).toMatch(/from "@\/server\/discovery\/discover-x"/);
    expect(ROUTE_SOURCE).toContain("discoverX(");
  });
});
