// Task 9 (spec 003): official X API v2 adapter — batch GET /2/tweets (≤ 100
// ids per call) mapping public_metrics to bigint PostMetrics. Never throws:
// every upstream failure degrades to a typed MetricsResult error.
import {
  asRecord,
  dateOrNull,
  errorForAll,
  fetchMetricsInChunks,
  stringOrNull,
  toBigInt,
} from "./adapter-util";
import type {
  MetricsProvider,
  MetricsResult,
  PostMetrics,
  PostRef,
} from "./provider";
import { XClient } from "./x-client";

const MAX_IDS_PER_CALL = 100;

export class XApiMetricsProvider implements MetricsProvider {
  readonly platform = "x" as const;
  private readonly client: XClient;

  constructor(options: { bearerToken: string; fetchImpl?: typeof fetch }) {
    this.client = new XClient(options);
  }

  async fetchMetrics(refs: PostRef[]): Promise<Map<string, MetricsResult>> {
    return fetchMetricsInChunks(refs, MAX_IDS_PER_CALL, (chunk) =>
      this.fetchBatch(chunk.map((ref) => ref.platformPostId)),
    );
  }

  private async fetchBatch(ids: string[]): Promise<Map<string, MetricsResult>> {
    const result = await this.client.get("/tweets", {
      ids: ids.join(","),
      "tweet.fields": "public_metrics,created_at",
      expansions: "author_id",
      "user.fields": "username,name,profile_image_url",
    });
    if (!result.ok) return errorForAll(ids, result.error, result.retryable);
    return mapBody(ids, result.body, new Date());
  }
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

  return {
    views: toBigInt(metrics.impression_count),
    likes: toBigInt(metrics.like_count),
    comments: toBigInt(metrics.reply_count),
    shares: toBigInt(metrics.retweet_count) + toBigInt(metrics.quote_count),
    capturedAt,
    postedAt: dateOrNull(tweet.created_at),
    authorHandle: stringOrNull(author?.username),
    authorDisplayName: stringOrNull(author?.name),
    authorAvatarUrl: stringOrNull(author?.profile_image_url),
  };
}
