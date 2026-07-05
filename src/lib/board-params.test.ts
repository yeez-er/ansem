// Task 22 (spec 008): board URL state as pure data. parseBoardParams must be
// junk-proof (a mangled shared link renders the default board, never a 500),
// boardHref is the single canonical URL builder (shareable, back-button-safe),
// and the countdown math is UTC-only with `now` as a parameter — no ambient
// clock in src/lib.
import { describe, expect, it } from "vitest";
import {
  BOARD_LIMIT_MAX,
  BOARD_PAGE_SIZE,
  boardHref,
  formatCountdown,
  msUntilNextUtcMidnight,
  nextBoardLimit,
  parseBoardParams,
} from "./board-params";

describe("parseBoardParams", () => {
  it("returns the default board for empty search params", () => {
    expect(parseBoardParams({})).toEqual({
      period: "daily",
      platform: "all",
      limit: BOARD_PAGE_SIZE,
    });
  });

  it.each([
    ["alltime", "alltime"],
    ["daily", "daily"],
  ] as const)("accepts period=%s", (raw, period) => {
    expect(parseBoardParams({ period: raw }).period).toBe(period);
  });

  it.each([
    ["unknown value", "yesterday"],
    ["wrong case", "ALLTIME"],
    ["empty string", ""],
  ])("falls back to daily for a period with %s", (_label, raw) => {
    expect(parseBoardParams({ period: raw }).period).toBe("daily");
  });

  it("treats a repeated period param (array) as absent", () => {
    expect(parseBoardParams({ period: ["alltime", "daily"] }).period).toBe(
      "daily",
    );
  });

  it.each([["x"], ["tiktok"], ["instagram"], ["all"]] as const)(
    "accepts platform=%s",
    (raw) => {
      expect(parseBoardParams({ platform: raw }).platform).toBe(raw);
    },
  );

  it.each([
    ["unknown platform", "youtube"],
    ["wrong case", "TikTok"],
    ["repeated param", ["x", "tiktok"]],
  ])("falls back to all for %s", (_label, raw) => {
    expect(parseBoardParams({ platform: raw }).platform).toBe("all");
  });

  it.each([
    ["1", 1],
    ["50", 50],
    ["100", 100],
    ["007", 7],
  ])("accepts limit=%s as %i", (raw, limit) => {
    expect(parseBoardParams({ limit: raw }).limit).toBe(limit);
  });

  it("clamps an oversized limit to the API cap so a stale link still works", () => {
    expect(parseBoardParams({ limit: "101" }).limit).toBe(BOARD_LIMIT_MAX);
    expect(parseBoardParams({ limit: "99999999999999999999" }).limit).toBe(
      BOARD_LIMIT_MAX,
    );
  });

  it.each([
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "12.5"],
    ["junk", "NaN"],
    ["empty", ""],
    ["repeated param", ["10", "20"]],
  ])("falls back to the page size for a %s limit", (_label, raw) => {
    expect(parseBoardParams({ limit: raw }).limit).toBe(BOARD_PAGE_SIZE);
  });

  it("never throws on fully hostile input", () => {
    expect(
      parseBoardParams({
        period: ["a", "b"],
        platform: "javascript:alert(1)",
        limit: "1e9",
      }),
    ).toEqual({ period: "daily", platform: "all", limit: BOARD_PAGE_SIZE });
  });
});

describe("boardHref", () => {
  it("omits defaults so the default board is the bare home URL", () => {
    expect(boardHref({ period: "daily", platform: "all" })).toBe("/");
  });

  it.each([
    [{ period: "alltime", platform: "all" }, "/?period=alltime"],
    [{ period: "daily", platform: "tiktok" }, "/?platform=tiktok"],
    [
      { period: "alltime", platform: "x", limit: 50 },
      "/?period=alltime&platform=x&limit=50",
    ],
    [{ period: "daily", platform: "all", limit: 50 }, "/?limit=50"],
    // the default page size is a default too — canonical URLs omit it
    [
      { period: "alltime", platform: "all", limit: BOARD_PAGE_SIZE },
      "/?period=alltime",
    ],
  ] as const)("builds %j as %s", (params, href) => {
    expect(boardHref(params)).toBe(href);
  });

  it("round-trips through parseBoardParams", () => {
    const params = {
      period: "alltime",
      platform: "instagram",
      limit: 75,
    } as const;
    const url = new URL(boardHref(params), "https://board.test");
    expect(
      parseBoardParams(Object.fromEntries(url.searchParams.entries())),
    ).toEqual(params);
  });
});

describe("nextBoardLimit", () => {
  it.each([
    [BOARD_PAGE_SIZE, BOARD_PAGE_SIZE * 2],
    [5, 30],
    [80, BOARD_LIMIT_MAX],
    [99, BOARD_LIMIT_MAX],
  ])("grows %i to %i", (current, next) => {
    expect(nextBoardLimit(current)).toBe(next);
  });

  it("returns null once the API cap is on screen (no dead Load more)", () => {
    expect(nextBoardLimit(BOARD_LIMIT_MAX)).toBeNull();
    expect(nextBoardLimit(BOARD_LIMIT_MAX + 1)).toBeNull();
  });
});

describe("msUntilNextUtcMidnight", () => {
  it.each([
    // [label, now, expected ms]
    ["mid-evening", "2026-07-06T21:00:00.000Z", 10_800_000],
    ["exactly at the reset instant", "2026-07-06T00:00:00.000Z", 86_400_000],
    ["the last millisecond of the day", "2026-07-06T23:59:59.999Z", 1],
    ["a year boundary", "2026-12-31T23:00:00.000Z", 3_600_000],
    // Feb 29 exists in 2028 — Date.UTC day-overflow must roll onto it.
    ["a leap-day boundary", "2028-02-28T12:00:00.000Z", 43_200_000],
    // A US DST-transition date: UTC math must be immune to the host timezone.
    ["a DST transition date", "2026-03-08T05:30:00.000Z", 66_600_000],
  ])("computes the gap at %s", (_label, now, ms) => {
    expect(msUntilNextUtcMidnight(new Date(now))).toBe(ms);
  });
});

describe("formatCountdown", () => {
  it.each([
    [10_800_000, "03:00:00"],
    [3_661_000, "01:01:01"],
    [1_000, "00:00:01"],
    // ceil to whole seconds: a live countdown never reads 00:00:00 while
    // time remains
    [1, "00:00:01"],
    [1_001, "00:00:02"],
    [59_999, "00:01:00"],
    // the exact reset instant reads as a full day to the next one
    [86_400_000, "24:00:00"],
  ])("formats %i ms as %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});
