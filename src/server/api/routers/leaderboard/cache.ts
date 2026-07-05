// Task 19 (spec 007): every leaderboard read is cached for 60 seconds per
// input key through Next's incremental cache — never a hand-rolled in-process
// Map (best-effort only, resets per instance). `unstable_cache` is the
// runtime API for this scaffold: `'use cache'`/cacheLife require
// cacheComponents (off here) and compile away outside the Next toolchain.
//
// The validated input object is the cached function's ONLY argument, so every
// input field lands in the cache key (unstable_cache keys on keyParts +
// JSON.stringify(args)). The db handle rides the closure precisely so it can
// never be serialized into the key. Cached values round-trip through plain
// JSON, which the all-strings DTOs (dto.ts) are built for — a bigint here
// would throw, not corrupt.
import { unstable_cache } from "next/cache";

export const BOARD_CACHE_REVALIDATE_SECONDS = 60;

export function cachedQuery<Input, Result>(
  name: string,
  fn: (input: Input) => Promise<Result>,
): (input: Input) => Promise<Result> {
  return unstable_cache(fn, [name], {
    revalidate: BOARD_CACHE_REVALIDATE_SECONDS,
  });
}
