// Task 8 (spec 003): provider registry — mock is the dev fallback whenever a
// platform has no configured live provider; in production an unconfigured
// platform returns null and mock data is NEVER selected (swept across every
// mode/override combination); per-platform overrides beat the global mode.
import { describe, expect, it } from "vitest";
import { parseServerEnv, type ServerEnv } from "@/env";
import type { Platform } from "@/lib/post-url";
import { MockMetricsProvider } from "./mock-provider";
import { getProvider, resolveProviderMode } from "./provider";

const PLATFORMS: Platform[] = ["x", "tiktok", "instagram"];

// Build a real ServerEnv through the boot parser so registry tests exercise
// exactly what production code receives (blank-normalization included).
function makeEnv(overrides: Record<string, string> = {}): ServerEnv {
  return parseServerEnv({
    DATABASE_URL: "postgresql://user:password@localhost:5432/ansem_test",
    ...overrides,
  });
}

const overrideKeyFor = (platform: Platform) =>
  `METRICS_PROVIDER_${platform.toUpperCase()}`;

describe("getProvider — dev fallback", () => {
  it.each(PLATFORMS)(
    "dev + nothing configured → MockMetricsProvider for %s (platform matches)",
    (platform) => {
      const provider = getProvider(platform, {
        env: makeEnv(),
        isProduction: false,
      });
      expect(provider).toBeInstanceOf(MockMetricsProvider);
      expect(provider?.platform).toBe(platform);
    },
  );

  it("dev + explicit METRICS_PROVIDER=mock → mock", () => {
    const provider = getProvider("x", {
      env: makeEnv({ METRICS_PROVIDER: "mock" }),
      isProduction: false,
    });
    expect(provider).toBeInstanceOf(MockMetricsProvider);
  });

  it("dev + METRICS_PROVIDER=live with no live adapter registered → falls back to mock", () => {
    // Live adapters land in Tasks 9–11; until a platform has one AND its keys,
    // dev keeps working on the mock (spec: mock in dev when no keys configured).
    const provider = getProvider("tiktok", {
      env: makeEnv({ METRICS_PROVIDER: "live" }),
      isProduction: false,
    });
    expect(provider).toBeInstanceOf(MockMetricsProvider);
  });

  it("dev: per-platform mock override wins even when the global mode is live", () => {
    const provider = getProvider("tiktok", {
      env: makeEnv({
        METRICS_PROVIDER: "live",
        METRICS_PROVIDER_TIKTOK: "mock",
      }),
      isProduction: false,
    });
    expect(provider).toBeInstanceOf(MockMetricsProvider);
  });
});

describe("getProvider — production never serves mock data", () => {
  it.each(PLATFORMS)(
    "production + nothing configured → null for %s (ingestion skips, spec 004)",
    (platform) => {
      expect(
        getProvider(platform, { env: makeEnv(), isProduction: true }),
      ).toBeNull();
    },
  );

  it("production + explicit METRICS_PROVIDER=mock → null (mock is dev/test only)", () => {
    expect(
      getProvider("x", {
        env: makeEnv({ METRICS_PROVIDER: "mock" }),
        isProduction: true,
      }),
    ).toBeNull();
  });

  it("production sweep: no mode/override combination ever selects the mock", () => {
    const modes = [undefined, "mock", "live"] as const;
    for (const globalMode of modes) {
      for (const overrideMode of modes) {
        for (const platform of PLATFORMS) {
          const provider = getProvider(platform, {
            env: makeEnv({
              ...(globalMode ? { METRICS_PROVIDER: globalMode } : {}),
              ...(overrideMode
                ? { [overrideKeyFor(platform)]: overrideMode }
                : {}),
            }),
            isProduction: true,
          });
          // With no live adapter registered and no keys set, every production
          // combination must resolve to null — and never to the mock.
          expect(
            provider,
            `global=${globalMode} override=${overrideMode} platform=${platform}`,
          ).toBeNull();
        }
      }
    }
  });
});

describe("resolveProviderMode — pure mode resolution", () => {
  it("a platform override beats the global METRICS_PROVIDER", () => {
    const env = makeEnv({
      METRICS_PROVIDER: "live",
      METRICS_PROVIDER_TIKTOK: "mock",
    });
    expect(resolveProviderMode("tiktok", env)).toBe("mock");
    expect(resolveProviderMode("x", env)).toBe("live");
    expect(resolveProviderMode("instagram", env)).toBe("live");
  });

  it.each(PLATFORMS)(
    "global mode alone applies to %s when no override is set",
    (platform) => {
      expect(
        resolveProviderMode(platform, makeEnv({ METRICS_PROVIDER: "mock" })),
      ).toBe("mock");
    },
  );

  it("nothing configured → undefined (registry applies the dev/prod default)", () => {
    expect(resolveProviderMode("x", makeEnv())).toBeUndefined();
  });
});
