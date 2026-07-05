// Task 14 (spec 004): /api/cron/refresh-metrics route. The route is thin —
// auth + refreshMetrics() + one structured summary line — so orchestration is
// mocked here (its behavior is Task 13's real-DB suite); these tests own the
// HTTP contract: the auth matrix over BOTH exported methods (spec pins POST;
// Vercel Cron itself invokes cron paths with GET), the summary response, the
// log level split, and source verification for the timing-safe compare +
// vercel.json cron entry.
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
import type { RefreshSummary } from "@/server/ingestion/refresh-metrics";

const SECRET = "cron-secret-for-route-tests";

const state = vi.hoisted(() => ({
  cronSecret: undefined as string | undefined,
}));
const refreshMetricsMock = vi.hoisted(() => vi.fn());
const FAKE_DB = vi.hoisted(() => ({ fake: "db" }));

vi.mock("@/env", () => ({
  getEnv: () => ({ CRON_SECRET: state.cronSecret }),
}));
vi.mock("@/server/db", () => ({ getDb: () => FAKE_DB }));
vi.mock("@/server/ingestion/refresh-metrics", () => ({
  refreshMetrics: refreshMetricsMock,
}));

import { GET, maxDuration, POST } from "@/app/api/cron/refresh-metrics/route";

const SUMMARY: RefreshSummary = {
  selected: 3,
  refreshed: 2,
  removed: 0,
  skipped: 0,
  errors: 1,
  durationMs: 42,
  degraded: false,
};

function request(method: string, authorization?: string): Request {
  return new Request("http://test.internal/api/cron/refresh-metrics", {
    method,
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe.each([
  ["GET", GET],
  ["POST", POST],
] as const)("%s /api/cron/refresh-metrics", (method, handler) => {
  let infoSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    state.cronSecret = SECRET;
    refreshMetricsMock.mockReset().mockResolvedValue(SUMMARY);
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
      expect(refreshMetricsMock).not.toHaveBeenCalled();
    },
  );

  it("fails closed when CRON_SECRET is unset — even `Bearer undefined` is 401", async () => {
    state.cronSecret = undefined;
    const res = await handler(request(method, "Bearer undefined"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(refreshMetricsMock).not.toHaveBeenCalled();
  });

  it("valid secret → 200 with the summary + exactly one structured info line", async () => {
    const res = await handler(request(method, `Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual(SUMMARY);
    expect(refreshMetricsMock).toHaveBeenCalledTimes(1);
    expect(refreshMetricsMock).toHaveBeenCalledWith(FAKE_DB);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line).toStrictEqual({ event: "refresh_metrics.run", ...SUMMARY });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("degraded run → still 200 (no cron retry-storm) but logged at ERROR level", async () => {
    const degraded: RefreshSummary = { ...SUMMARY, errors: 3, degraded: true };
    refreshMetricsMock.mockResolvedValue(degraded);

    const res = await handler(request(method, `Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual(degraded);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toStrictEqual({ event: "refresh_metrics.run", ...degraded });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("orchestration rejection (e.g. DB unreachable) → 500 + structured error, no unhandled rejection", async () => {
    refreshMetricsMock.mockRejectedValue(new Error("connection refused"));

    const res = await handler(request(method, `Bearer ${SECRET}`));

    expect(res.status).toBe(500);
    expect(await res.json()).toStrictEqual({ ok: false });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(line).toStrictEqual({
      event: "refresh_metrics.failed",
      message: "connection refused",
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("source verification", () => {
  const ROUTE_SOURCE = readFileSync(
    "src/app/api/cron/refresh-metrics/route.ts",
    "utf8",
  );
  const AUTH_SOURCE = readFileSync("src/lib/cron-auth.ts", "utf8");

  // Flags an equality operator touching the secret (or a `Bearer …` template)
  // — the timing-oracle pattern spec 004 bans.
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

  it("secret comparison is timing-safe — no === on the secret anywhere", () => {
    expect(AUTH_SOURCE).toContain("timingSafeEqual(");
    expect(NAIVE_COMPARE.test(AUTH_SOURCE)).toBe(false);
    expect(NAIVE_COMPARE.test(ROUTE_SOURCE)).toBe(false);
  });

  it("route delegates auth to the shared constant-time helper", () => {
    expect(ROUTE_SOURCE).toContain("isAuthorizedCronRequest(");
  });

  it("route pins maxDuration to the 300s Apify sync ceiling (Task 11 note)", () => {
    // Next.js statically analyzes the export — it must be a literal.
    expect(ROUTE_SOURCE).toContain("export const maxDuration = 300");
    expect(maxDuration).toBe(300);
  });

  it("vercel.json registers the */30 cron on the exact route path", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toContainEqual({
      path: "/api/cron/refresh-metrics",
      schedule: "*/30 * * * *",
    });
  });
});
