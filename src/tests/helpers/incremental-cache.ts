// Task 19 (spec 007): minimal in-memory stand-in for the Next server's
// incremental cache. `unstable_cache` invoked outside a request (exactly our
// Vitest situation) reads `globalThis.__incrementalCache` — the same seam the
// real server populates — and throws E469 when it is absent, so every suite
// that calls a cached procedure must install this fake first.
//
// Staleness mirrors the real handler's FETCH-entry rule: an entry is stale
// once its age in seconds exceeds its revalidate window. Date.now() is used
// deliberately — suites pin it with Date-only fake timers, which is what makes
// TTL behavior testable.
//
// This Map lives in TEST infrastructure as the platform cache's stand-in; the
// router itself must never hand-roll one (source-verified in cache.test.ts).

type FetchCacheEntry = {
  kind: string;
  data: { body: string };
  revalidate: number;
};

type StoredEntry = { entry: FetchCacheEntry; lastModified: number };

export class FakeIncrementalCache {
  private readonly store = new Map<string, StoredEntry>();
  readonly isOnDemandRevalidate = false;

  entryCount(): number {
    return this.store.size;
  }

  async generateCacheKey(invocationKey: string): Promise<string> {
    return invocationKey;
  }

  async get(
    cacheKey: string,
    ctx?: { revalidate?: number | false },
  ): Promise<{ value: FetchCacheEntry; isStale: boolean } | null> {
    const hit = this.store.get(cacheKey);
    if (hit === undefined) return null;
    const revalidate =
      typeof ctx?.revalidate === "number"
        ? ctx.revalidate
        : hit.entry.revalidate;
    const ageSeconds = (Date.now() - hit.lastModified) / 1000;
    return { value: hit.entry, isStale: ageSeconds > revalidate };
  }

  async set(cacheKey: string, entry: FetchCacheEntry): Promise<void> {
    this.store.set(cacheKey, { entry, lastModified: Date.now() });
  }
}

const GLOBAL_KEY = "__incrementalCache";

// Install a FRESH fake per test (beforeEach) so cached responses can never
// bleed across tests; uninstall in afterAll so later suites never inherit it.
export function installFakeIncrementalCache(): FakeIncrementalCache {
  const fake = new FakeIncrementalCache();
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = fake;
  return fake;
}

export function uninstallFakeIncrementalCache(): void {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}
