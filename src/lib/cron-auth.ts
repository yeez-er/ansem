// Cron route bearer auth (spec 004): compare in constant time — a plain
// equality operator on the secret is a timing oracle (spec 004 bans it).
// SHA-256 both sides first so timingSafeEqual
// always receives equal-length buffers (it throws on a mismatch) and the
// comparison leaks neither content nor length. Shared by every cron route
// (refresh-metrics now, discover-x in Task 16).
import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  secret: string | undefined,
): boolean {
  // No configured secret = fail closed. env blank-normalizes "" to undefined,
  // but the helper must not rely on that: an empty secret would otherwise let
  // a bare `Bearer ` header through.
  if (authorizationHeader === null || !secret) return false;
  return timingSafeEqual(
    digest(authorizationHeader),
    digest(`Bearer ${secret}`),
  );
}
