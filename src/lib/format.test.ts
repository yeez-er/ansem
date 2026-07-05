// Spec 008: counts abbreviate ("1.2M", "48.3K") with the exact grouped value
// available for `title`. Counts cross the API as strings and can exceed 2^53
// (X views) — the formatter must stay bigint-exact end-to-end.

import { describe, expect, it } from "vitest";
import { abbreviateCount, formatFullCount } from "./format";

describe("abbreviateCount", () => {
  it.each([
    // spec-named examples (hand-derived, not observed output)
    ["1234567", "1.2M"],
    ["48300", "48.3K"],
    // truthiness guard: 0 renders as "0", never blank
    ["0", "0"],
    ["999", "999"],
    ["1000", "1K"],
    ["1500", "1.5K"],
    // round-half-up inside a unit
    ["1049", "1K"],
    ["1050", "1.1K"],
    // rounding at the unit boundary must promote, never emit "1000.0K"
    ["999950", "1M"],
    ["1000000", "1M"],
    ["2500000000", "2.5B"],
    ["1000000000000", "1T"],
  ])("%s → %s", (input, expected) => {
    expect(abbreviateCount(input)).toBe(expected);
  });

  it("2^53+1 stays bigint-exact (no Number collapse)", () => {
    // 9007199254740993 / 1e12 = 9007.199…, half-up to one decimal = 9007.2
    expect(abbreviateCount("9007199254740993")).toBe("9007.2T");
  });

  it.each([[""], ["not a number"], ["12.5"], ["-5"], ["1e6"], ["1,000"]])(
    "invalid count %j → null (never NaN text, never a throw)",
    (input) => {
      expect(abbreviateCount(input)).toBeNull();
    },
  );
});

describe("formatFullCount", () => {
  it.each([
    ["0", "0"],
    ["999", "999"],
    ["1000", "1,000"],
    ["1234567", "1,234,567"],
    ["9007199254740993", "9,007,199,254,740,993"],
  ])("%s → %s", (input, expected) => {
    expect(formatFullCount(input)).toBe(expected);
  });

  it.each([[""], ["abc"], ["-5"], ["12.5"]])("invalid %j → null", (input) => {
    expect(formatFullCount(input)).toBeNull();
  });
});
