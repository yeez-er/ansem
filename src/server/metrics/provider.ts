// Spec 003: MetricsProvider contract + registry. Providers NEVER throw — every
// per-post outcome is a typed MetricsResult in the returned Map. Mock data
// must never reach production: an unconfigured platform resolves to null there
// and the ingestion cron counts it as skipped (spec 004).
import type { ServerEnv } from "@/env";
import type { Platform } from "@/lib/post-url";
import { MockMetricsProvider } from "./mock-provider";
import { XApiMetricsProvider } from "./x-api-provider";

export type PostRef = {
  platform: Platform;
  platformPostId: string;
  url: string;
};

export type PostMetrics = {
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  capturedAt: Date;
  // Author metadata feeds placeholder-creator resolution (spec 004); not every
  // live adapter can supply it, so each field is nullable.
  postedAt: Date | null;
  authorHandle: string | null;
  authorDisplayName: string | null;
  authorAvatarUrl: string | null;
};

export type MetricsErrorCode = "NOT_FOUND" | "RATE_LIMITED" | "PROVIDER_ERROR";

export type MetricsResult =
  | { ok: true; metrics: PostMetrics }
  | { ok: false; error: MetricsErrorCode; retryable: boolean };

export type MetricsProvider = {
  platform: Platform;
  fetchMetrics(refs: PostRef[]): Promise<Map<string, MetricsResult>>;
};

export type ProviderMode = "mock" | "live";

const OVERRIDE_KEY = {
  x: "METRICS_PROVIDER_X",
  tiktok: "METRICS_PROVIDER_TIKTOK",
  instagram: "METRICS_PROVIDER_INSTAGRAM",
} as const satisfies Record<Platform, keyof ServerEnv>;

export function resolveProviderMode(
  platform: Platform,
  env: ServerEnv,
): ProviderMode | undefined {
  return env[OVERRIDE_KEY[platform]] ?? env.METRICS_PROVIDER;
}

// Live adapters register here: SocialData (Task 10) replaces the X slot when
// it lands; Apify (Task 11) fills tiktok/instagram — each factory gates on
// its own API keys and returns null when they are absent.
const LIVE_PROVIDERS: Partial<
  Record<Platform, (env: ServerEnv) => MetricsProvider | null>
> = {
  x: (env) =>
    env.X_BEARER_TOKEN
      ? new XApiMetricsProvider({ bearerToken: env.X_BEARER_TOKEN })
      : null,
};

export function getProvider(
  platform: Platform,
  { env, isProduction }: { env: ServerEnv; isProduction: boolean },
): MetricsProvider | null {
  const mode = resolveProviderMode(platform, env);

  if (mode !== "mock") {
    const live = LIVE_PROVIDERS[platform]?.(env) ?? null;
    if (live) return live;
  }

  // No live provider available: production degrades to null (never mock
  // data); dev always has a working provider — the deterministic mock.
  return isProduction ? null : new MockMetricsProvider(platform);
}
