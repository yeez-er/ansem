// Task 9 (spec 003): official X API v2 adapter — batch GET /2/tweets (≤ 100
// ids per call) mapping public_metrics to bigint PostMetrics. Never throws:
// every upstream failure degrades to a typed MetricsResult error.
import type {
  MetricsProvider,
  MetricsResult,
  PostMetrics,
  PostRef,
} from "./provider";

const X_API_TWEETS_URL = "https://api.x.com/2/tweets";
const MAX_IDS_PER_CALL = 100;
const REQUEST_TIMEOUT_MS = 10_000;

export class XApiMetricsProvider implements MetricsProvider {
  readonly platform = "x" as const;
  private readonly bearerToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { bearerToken: string; fetchImpl?: typeof fetch }) {
    this.bearerToken = options.bearerToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchMetrics(refs: PostRef[]): Promise<Map<string, MetricsResult>> {
    const results = new Map<string, MetricsResult>();
    for (let i = 0; i < refs.length; i += MAX_IDS_PER_CALL) {
      const ids = refs
        .slice(i, i + MAX_IDS_PER_CALL)
        .map((ref) => ref.platformPostId);
      let batch: Map<string, MetricsResult>;
      try {
        batch = await this.fetchBatch(ids);
      } catch {
        // Contract backstop: an unexpected bug degrades to typed errors for
        // this chunk instead of rejecting the whole run.
        batch = errorForAll(ids, "PROVIDER_ERROR", false);
      }
      for (const [id, result] of batch) results.set(id, result);
    }
    return results;
  }

  private async fetchBatch(ids: string[]): Promise<Map<string, MetricsResult>> {
    let response: Response;
    try {
      const url = new URL(X_API_TWEETS_URL);
      url.searchParams.set("ids", ids.join(","));
      url.searchParams.set("tweet.fields", "public_metrics,created_at");
      url.searchParams.set("expansions", "author_id");
      url.searchParams.set("user.fields", "username,name,profile_image_url");
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network failure or timeout — transient, worth retrying next run.
      return errorForAll(ids, "PROVIDER_ERROR", true);
    }

    if (response.status === 429) return errorForAll(ids, "RATE_LIMITED", true);
    if (!response.ok) {
      return errorForAll(ids, "PROVIDER_ERROR", response.status >= 500);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return errorForAll(ids, "PROVIDER_ERROR", false);
    }
    return mapBody(ids, body, new Date());
  }
}

function errorForAll(
  ids: string[],
  error: "RATE_LIMITED" | "PROVIDER_ERROR",
  retryable: boolean,
): Map<string, MetricsResult> {
  return new Map(ids.map((id) => [id, { ok: false, error, retryable }]));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapBody(
  ids: string[],
  body: unknown,
  capturedAt: Date,
): Map<string, MetricsResult> {
  const results = new Map<string, MetricsResult>();
  const record = asRecord(body);
  const data = Array.isArray(record?.data) ? record.data : [];
  const errors = Array.isArray(record?.errors) ? record.errors : [];

  const users = new Map<string, Record<string, unknown>>();
  const includes = asRecord(record?.includes);
  for (const entry of Array.isArray(includes?.users) ? includes.users : []) {
    const user = asRecord(entry);
    if (typeof user?.id === "string") users.set(user.id, user);
  }

  for (const entry of data) {
    const tweet = asRecord(entry);
    if (typeof tweet?.id !== "string") continue;
    try {
      results.set(tweet.id, {
        ok: true,
        metrics: mapTweet(tweet, users, capturedAt),
      });
    } catch {
      results.set(tweet.id, {
        ok: false,
        error: "PROVIDER_ERROR",
        retryable: false,
      });
    }
  }

  // Per-id errors entries (deleted, suspended, protected) are permanent —
  // the caller marks the post removed (spec 004).
  for (const entry of errors) {
    const err = asRecord(entry);
    if (typeof err?.value === "string" && !results.has(err.value)) {
      results.set(err.value, {
        ok: false,
        error: "NOT_FOUND",
        retryable: false,
      });
    }
  }

  // Defensive: a requested id absent from both data and errors still gets a
  // typed result — the returned Map never has silent gaps.
  for (const id of ids) {
    if (!results.has(id)) {
      results.set(id, { ok: false, error: "PROVIDER_ERROR", retryable: false });
    }
  }
  return results;
}

function mapTweet(
  tweet: Record<string, unknown>,
  users: Map<string, Record<string, unknown>>,
  capturedAt: Date,
): PostMetrics {
  const metrics = asRecord(tweet.public_metrics);
  if (!metrics) throw new Error("tweet entry missing public_metrics");

  const author =
    typeof tweet.author_id === "string" ? users.get(tweet.author_id) : null;
  const postedAt =
    typeof tweet.created_at === "string" ? new Date(tweet.created_at) : null;

  return {
    views: toBigInt(metrics.impression_count),
    likes: toBigInt(metrics.like_count),
    comments: toBigInt(metrics.reply_count),
    shares: toBigInt(metrics.retweet_count) + toBigInt(metrics.quote_count),
    capturedAt,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    authorHandle: stringOrNull(author?.username),
    authorDisplayName: stringOrNull(author?.name),
    authorAvatarUrl: stringOrNull(author?.profile_image_url),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// JSON numbers are exact up to 2^53 − 1, which covers real X counts; anything
// non-numeric or unsafe throws and the tweet degrades to PROVIDER_ERROR.
function toBigInt(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `expected a non-negative safe integer, got ${String(value)}`,
    );
  }
  return BigInt(value);
}
