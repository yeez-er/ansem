// Task 10 (spec 003): SocialData.tools adapter — the designated X refresh
// path ($0.20/1k vs $5/1k official; third-party risk accepted 2026-07-05).
// Bulk tweets-by-ids, built against recorded fixture shapes in v1. Never
// throws: every upstream failure degrades to a typed MetricsResult error.
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

const SOCIALDATA_TWEETS_URL =
  "https://api.socialdata.tools/twitter/tweets-by-ids";
const MAX_IDS_PER_CALL = 100;
const REQUEST_TIMEOUT_MS = 10_000;

export class SocialDataProvider implements MetricsProvider {
  readonly platform = "x" as const;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { apiKey: string; fetchImpl?: typeof fetch }) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchMetrics(refs: PostRef[]): Promise<Map<string, MetricsResult>> {
    return fetchMetricsInChunks(refs, MAX_IDS_PER_CALL, (chunk) =>
      this.fetchBatch(chunk.map((ref) => ref.platformPostId)),
    );
  }

  private async fetchBatch(ids: string[]): Promise<Map<string, MetricsResult>> {
    let response: Response;
    try {
      const url = new URL(SOCIALDATA_TWEETS_URL);
      url.searchParams.set("tweet_ids", ids.join(","));
      response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network failure or timeout — transient, worth retrying next run.
      return errorForAll(ids, "PROVIDER_ERROR", true);
    }

    if (response.status === 429) return errorForAll(ids, "RATE_LIMITED", true);
    if (!response.ok) {
      // 402 (insufficient credits) and other 4xx need operator action; only
      // 5xx is worth an automatic retry.
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

function mapBody(
  ids: string[],
  body: unknown,
  capturedAt: Date,
): Map<string, MetricsResult> {
  const tweets = asRecord(body)?.tweets;
  // A body without a tweets array is shape drift, not a batch of deletions —
  // absence-means-NOT_FOUND below is only safe inside a well-formed response.
  if (!Array.isArray(tweets)) return errorForAll(ids, "PROVIDER_ERROR", false);

  const results = new Map<string, MetricsResult>();
  for (const entry of tweets) {
    const tweet = asRecord(entry);
    // Always key by id_str — the numeric `id` field exceeds 2^53.
    if (typeof tweet?.id_str !== "string") continue;
    try {
      results.set(tweet.id_str, {
        ok: true,
        metrics: mapTweet(tweet, capturedAt),
      });
    } catch {
      // Includes views_count: null — a real-likes/zero-views row would score
      // wrong-but-plausible, so the post degrades instead of fabricating 0n.
      results.set(tweet.id_str, {
        ok: false,
        error: "PROVIDER_ERROR",
        retryable: false,
      });
    }
  }

  // Bulk semantics: a requested id absent from a well-formed tweets array is
  // gone at source (deleted/suspended) — the caller marks it removed.
  for (const id of ids) {
    if (!results.has(id)) {
      results.set(id, { ok: false, error: "NOT_FOUND", retryable: false });
    }
  }
  return results;
}

function mapTweet(
  tweet: Record<string, unknown>,
  capturedAt: Date,
): PostMetrics {
  const author = asRecord(tweet.user);
  return {
    views: toBigInt(tweet.views_count),
    likes: toBigInt(tweet.favorite_count),
    comments: toBigInt(tweet.reply_count),
    shares: toBigInt(tweet.retweet_count) + toBigInt(tweet.quote_count),
    capturedAt,
    postedAt: dateOrNull(tweet.tweet_created_at),
    authorHandle: stringOrNull(author?.screen_name),
    authorDisplayName: stringOrNull(author?.name),
    authorAvatarUrl: stringOrNull(author?.profile_image_url_https),
  };
}
