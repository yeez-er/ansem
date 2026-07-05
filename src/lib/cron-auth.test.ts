// Task 14 (spec 004): constant-time cron bearer auth. Pure helper — the same
// check guards /api/cron/refresh-metrics now and /api/cron/discover-x (Task 16).
import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("isAuthorizedCronRequest", () => {
  it("accepts the exact `Bearer <secret>` header", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
  });

  it.each([
    ["a wrong secret", `Bearer ${SECRET}x`],
    ["a truncated secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["the raw secret without the Bearer scheme", SECRET],
    ["a lowercase scheme (Vercel Cron sends `Bearer`)", `bearer ${SECRET}`],
    ["extra whitespace after the scheme", `Bearer  ${SECRET}`],
    ["an empty header", ""],
  ])("rejects %s", (_label, header) => {
    expect(isAuthorizedCronRequest(header, SECRET)).toBe(false);
  });

  describe("fails closed when CRON_SECRET is not configured", () => {
    it.each([
      ["a plausible bearer header", `Bearer ${SECRET}`, undefined],
      ["the literal string 'undefined'", "Bearer undefined", undefined],
      ["a bare `Bearer ` header", "Bearer ", undefined],
      // env blank-normalizes "" to undefined, but the helper must not rely on
      // that: an empty secret can never match its own emptiness.
      ["an empty-string secret", "Bearer ", ""],
    ])("rejects %s", (_label, header, secret) => {
      expect(isAuthorizedCronRequest(header, secret)).toBe(false);
    });
  });

  it("returns false (never throws) on header/secret length mismatch", () => {
    // node's timingSafeEqual throws on unequal buffer lengths — the helper
    // must normalize lengths, not leak them as exceptions.
    expect(isAuthorizedCronRequest("B", SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}${SECRET}`, SECRET)).toBe(
      false,
    );
  });
});
