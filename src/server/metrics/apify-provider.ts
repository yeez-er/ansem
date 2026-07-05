// Task 11 (spec 003): Apify adapter — TikTok via clockworks/tiktok-scraper
// (batch postURLs) and Instagram via apify/instagram-post-scraper (its
// username field accepts post URLs per the actor's input schema). One sync
// actor run per chunk over run-sync-get-dataset-items; built against
// recorded fixture shapes in v1 (third-party risk accepted 2026-07-05).
// Never throws: every upstream failure degrades to a typed MetricsResult.
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

const APIFY_ACTORS_URL = "https://api.apify.com/v2/actors";
const MAX_URLS_PER_RUN = 100;
// Deliberately above the 10s HTTP default (spec 003): a sync actor run IS a
// scrape job, and Apify's own ceiling is 300s (the endpoint answers 408
// beyond it) — this abort only backstops a hung connection.
const REQUEST_TIMEOUT_MS = 300_000;

export type ApifyPlatform = "tiktok" | "instagram";

type ActorConfig = {
  actorId: string;
  buildInput: (refs: PostRef[]) => Record<string, unknown>;
  idOf: (item: Record<string, unknown>) => string | null;
  mapItem: (item: Record<string, unknown>, capturedAt: Date) => PostMetrics;
};

const ACTOR_CONFIG: Record<ApifyPlatform, ActorConfig> = {
  tiktok: {
    actorId: "clockworks~tiktok-scraper",
    buildInput: (refs) => ({ postURLs: refs.map((ref) => ref.url) }),
    // Items key by string id — numeric TikTok video ids exceed 2^53.
    idOf: (item) => stringOrNull(item.id),
    mapItem: (item, capturedAt) => {
      const author = asRecord(item.authorMeta);
      return {
        views: toBigInt(item.playCount),
        likes: toBigInt(item.diggCount),
        comments: toBigInt(item.commentCount),
        shares: toBigInt(item.shareCount),
        capturedAt,
        postedAt: dateOrNull(item.createTimeISO),
        authorHandle: stringOrNull(author?.name),
        authorDisplayName: stringOrNull(author?.nickName),
        authorAvatarUrl: stringOrNull(author?.avatar),
      };
    },
  },
  instagram: {
    actorId: "apify~instagram-post-scraper",
    buildInput: (refs) => ({ username: refs.map((ref) => ref.url) }),
    // shortCode matches parsePostUrl's platformPostId for Instagram.
    idOf: (item) => stringOrNull(item.shortCode),
    mapItem: (item, capturedAt) => ({
      // Absent for photo posts and likesCount is -1 when hidden — both throw
      // in toBigInt and degrade to a per-post PROVIDER_ERROR rather than
      // fabricating a plausible-but-wrong count (Task 10 semantics).
      views: toBigInt(item.videoViewCount),
      likes: toBigInt(item.likesCount),
      comments: toBigInt(item.commentsCount),
      // Instagram exposes no public reshare count — a uniform platform-wide
      // gap, not a per-post data failure.
      shares: 0n,
      capturedAt,
      postedAt: dateOrNull(item.timestamp),
      authorHandle: stringOrNull(item.ownerUsername),
      authorDisplayName: stringOrNull(item.ownerFullName),
      // Post items carry no owner avatar; placeholder resolution fills what
      // it can and leaves the rest null (spec 004).
      authorAvatarUrl: null,
    }),
  },
};

export class ApifyProvider implements MetricsProvider {
  readonly platform: ApifyPlatform;
  private readonly token: string;
  private readonly config: ActorConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    token: string;
    platform: ApifyPlatform;
    fetchImpl?: typeof fetch;
  }) {
    this.token = options.token;
    this.platform = options.platform;
    this.config = ACTOR_CONFIG[options.platform];
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchMetrics(refs: PostRef[]): Promise<Map<string, MetricsResult>> {
    return fetchMetricsInChunks(refs, MAX_URLS_PER_RUN, (chunk) =>
      this.fetchBatch(chunk),
    );
  }

  private async fetchBatch(
    refs: PostRef[],
  ): Promise<Map<string, MetricsResult>> {
    const ids = refs.map((ref) => ref.platformPostId);
    let response: Response;
    try {
      const url = new URL(
        `${APIFY_ACTORS_URL}/${this.config.actorId}/run-sync-get-dataset-items`,
      );
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(this.config.buildInput(refs)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network failure or timeout — transient, worth retrying next run.
      return errorForAll(ids, "PROVIDER_ERROR", true);
    }

    if (response.status === 429) return errorForAll(ids, "RATE_LIMITED", true);
    if (!response.ok) {
      // 408 = the sync run outlived Apify's 300s ceiling — transient like a
      // 5xx; 402 (out of credits) and other 4xx need operator action.
      return errorForAll(
        ids,
        "PROVIDER_ERROR",
        response.status >= 500 || response.status === 408,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return errorForAll(ids, "PROVIDER_ERROR", false);
    }
    return this.mapBody(ids, body, new Date());
  }

  private mapBody(
    ids: string[],
    body: unknown,
    capturedAt: Date,
  ): Map<string, MetricsResult> {
    // The sync run endpoint answers with the dataset items array itself; any
    // other shape is drift or an actor error object, not a batch of
    // deletions — absence-means-NOT_FOUND below is only safe inside a
    // well-formed response.
    if (!Array.isArray(body)) return errorForAll(ids, "PROVIDER_ERROR", false);

    const results = new Map<string, MetricsResult>();
    for (const entry of body) {
      const item = asRecord(entry);
      const id = item ? this.config.idOf(item) : null;
      if (!item || !id) continue;
      try {
        results.set(id, {
          ok: true,
          metrics: this.config.mapItem(item, capturedAt),
        });
      } catch {
        results.set(id, {
          ok: false,
          error: "PROVIDER_ERROR",
          retryable: false,
        });
      }
    }

    // A requested post absent from a well-formed items array is gone at
    // source (deleted/private) — the caller marks it removed (spec 004).
    for (const id of ids) {
      if (!results.has(id)) {
        results.set(id, { ok: false, error: "NOT_FOUND", retryable: false });
      }
    }
    return results;
  }
}
