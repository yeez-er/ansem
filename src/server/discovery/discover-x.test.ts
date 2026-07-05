// @vitest-environment node
// Task 16 (spec 005): discoverX orchestration — X recent-search discovery
// against a REAL test database with a scripted X client. Pins the spec's
// acceptance matrix: flag-off inertness, idempotent inserts via the natural-key
// UNIQUE gates, banned-creator skips, page budget + truncation, 429 graceful
// abort, and the commit-then-advance cursor rule (a mid-batch DB failure or an
// X abort must leave since_id untouched so the next run re-reads and dedupes).
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  creators,
  discoveryState,
  metricSnapshots,
  posts,
} from "@/server/db/schema";
import type { XApiResponse, XClient } from "@/server/metrics/x-client";
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";
import {
  clientFromEnv,
  DEFAULT_DISCOVERY_PAGES_PER_RUN,
  DEFAULT_X_SEARCH_QUERY,
  type DiscoverXOptions,
  discoverX,
  FALLBACK_X_SEARCH_QUERY,
  resolveDiscoveryEnabled,
  resolveDiscoveryPages,
  resolveSearchQuery,
} from "./discover-x";

const testDb = connectTestDb();
const { db } = testDb;
const { seedCreator, seedPost } = makeSeeders(db);

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

// Pinned run instant — capturedAt/updated_at and the first-run 24h window all
// derive from it, so assertions are absolute (Task 13 precedent, no fake timers).
const NOW = new Date("2026-07-05T12:00:00Z");
const DAY_BEFORE_ISO = "2026-07-04T12:00:00.000Z";

type SearchClient = Pick<XClient, "get">;
type Call = { path: string; params: Record<string, string> };

function makeClient(responses: XApiResponse[]) {
  const queue = [...responses];
  const calls: Call[] = [];
  const get = vi.fn(async (path: string, params: Record<string, string>) => {
    calls.push({ path, params: { ...params } });
    const next = queue.shift();
    if (!next) throw new Error("mock X client ran out of scripted responses");
    return next;
  });
  return { client: { get } as SearchClient, get, calls };
}

function baseOptions(
  client: SearchClient,
  overrides: Partial<DiscoverXOptions> = {},
): DiscoverXOptions {
  return {
    enabled: true,
    client,
    query: "test-query",
    pagesPerRun: 3,
    now: NOW,
    ...overrides,
  };
}

function userOf(id: string, username: string) {
  return {
    id,
    username,
    name: `Display ${username}`,
    profile_image_url: `https://pbs.example/${username}.jpg`,
  };
}

function tweetOf(
  id: string,
  authorId: string,
  metrics: Record<string, unknown> = {},
) {
  return {
    id,
    author_id: authorId,
    text: `gm $ANSEM ${id}`,
    created_at: "2026-07-05T08:00:00.000Z",
    public_metrics: {
      impression_count: 1000,
      like_count: 10,
      reply_count: 2,
      retweet_count: 1,
      quote_count: 0,
      ...metrics,
    },
  };
}

function pageOf(
  tweets: unknown[],
  users: unknown[],
  meta: Record<string, unknown> = {},
): XApiResponse {
  return {
    ok: true,
    body: {
      data: tweets,
      includes: { users },
      meta: { result_count: tweets.length, ...meta },
    },
  };
}

const rateLimited: XApiResponse = {
  ok: false,
  error: "RATE_LIMITED",
  retryable: true,
};
const providerError: XApiResponse = {
  ok: false,
  error: "PROVIDER_ERROR",
  retryable: true,
};

async function tableCounts() {
  return {
    creators: (await db.select().from(creators)).length,
    posts: (await db.select().from(posts)).length,
    snapshots: (await db.select().from(metricSnapshots)).length,
  };
}

async function cursorRow() {
  const rows = await db.select().from(discoveryState);
  return rows[0] ?? null;
}

async function seedCursor(cursor: string) {
  await db.insert(discoveryState).values({ platform: "x", cursor });
}

async function postByPlatformId(platformPostId: string) {
  const rows = await db
    .select()
    .from(posts)
    .where(
      and(eq(posts.platform, "x"), eq(posts.platformPostId, platformPostId)),
    );
  return rows[0] ?? null;
}

// Wraps the real db so the Nth db.transaction call rejects — a scripted
// transient DB failure for the cursor-stays-put acceptance criterion.
function failNthTransaction(real: typeof db, failOn: number): typeof db {
  let calls = 0;
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "transaction") {
        calls += 1;
        if (calls === failOn) {
          return async () => {
            throw new Error("injected transient DB failure");
          };
        }
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as typeof db;
}

describe("env resolvers (pure)", () => {
  it("resolveDiscoveryEnabled is false unless the flag is exactly 'true' (fail-closed)", () => {
    expect(resolveDiscoveryEnabled({ X_DISCOVERY_ENABLED: undefined })).toBe(
      false,
    );
    expect(resolveDiscoveryEnabled({ X_DISCOVERY_ENABLED: "false" })).toBe(
      false,
    );
    expect(resolveDiscoveryEnabled({ X_DISCOVERY_ENABLED: "true" })).toBe(true);
  });

  it("resolveDiscoveryPages defaults to the spec value 3 and honors the env override", () => {
    expect(DEFAULT_DISCOVERY_PAGES_PER_RUN).toBe(3);
    expect(
      resolveDiscoveryPages({ X_DISCOVERY_PAGES_PER_RUN: undefined }),
    ).toBe(3);
    expect(resolveDiscoveryPages({ X_DISCOVERY_PAGES_PER_RUN: 5 })).toBe(5);
  });

  it("resolveSearchQuery defaults to the spec query and honors the env override", () => {
    expect(resolveSearchQuery({ X_SEARCH_QUERY: undefined })).toBe(
      DEFAULT_X_SEARCH_QUERY,
    );
    expect(resolveSearchQuery({ X_SEARCH_QUERY: "custom" })).toBe("custom");
  });

  it("default query uses the $ANSEM cashtag and excludes retweets; the documented fallback quotes the cashtag (spec 005 ⚠️)", () => {
    expect(DEFAULT_X_SEARCH_QUERY).toContain("$ANSEM");
    expect(DEFAULT_X_SEARCH_QUERY).toContain("-is:retweet");
    // Cashtag operator historically rejected on lower tiers — the fallback
    // swaps it for an exact-phrase match and keeps the retweet exclusion.
    expect(FALLBACK_X_SEARCH_QUERY).toContain('"$ANSEM"');
    expect(FALLBACK_X_SEARCH_QUERY).toContain("-is:retweet");
  });

  it("clientFromEnv builds a client only when X_BEARER_TOKEN is set", () => {
    expect(clientFromEnv({ X_BEARER_TOKEN: undefined })).toBeNull();
    expect(clientFromEnv({ X_BEARER_TOKEN: "token" })).not.toBeNull();
  });
});

describe("feature gating (spec 005: OFF unless flag + token)", () => {
  it("disabled → exactly { skipped: true }, zero X calls, zero rows", async () => {
    const { client, get } = makeClient([pageOf([tweetOf("1", "u1")], [])]);

    const summary = await discoverX(
      db,
      baseOptions(client, { enabled: false }),
    );

    expect(summary).toEqual({ skipped: true });
    expect(get).not.toHaveBeenCalled();
    expect(await tableCounts()).toEqual({
      creators: 0,
      posts: 0,
      snapshots: 0,
    });
    expect(await cursorRow()).toBeNull();
  });

  it("enabled defaulting reads the env flag and fails closed when unset", async () => {
    // Precondition: the flag must not leak in from .env.local — if this fires,
    // the test env is polluted and every gating assertion below is meaningless.
    expect(process.env.X_DISCOVERY_ENABLED).toBeUndefined();
    const { client, get } = makeClient([pageOf([tweetOf("1", "u1")], [])]);

    const summary = await discoverX(db, { client, now: NOW });

    expect(summary).toEqual({ skipped: true });
    expect(get).not.toHaveBeenCalled();
  });

  it("enabled but no client available (no token) → skipped, no work", async () => {
    const summary = await discoverX(db, {
      enabled: true,
      client: null,
      now: NOW,
    });

    expect(summary).toEqual({ skipped: true });
    expect(await tableCounts()).toEqual({
      creators: 0,
      posts: 0,
      snapshots: 0,
    });
  });
});

describe("discovery writes (spec 005 step 4)", () => {
  // Ids differ only in the final digit beyond 2^53 — a Number/lexicographic
  // max would collapse or misorder them; the cursor must be the BigInt max.
  const ID_NEWEST = "1900000000000000003";
  const ID_OLDEST = "1900000000000000001";
  const ID_BIG_METRICS = "1900000000000000002";

  function threeResultPage(): XApiResponse {
    return pageOf(
      [
        tweetOf(ID_NEWEST, "u1"),
        tweetOf(ID_BIG_METRICS, "u3", {
          impression_count: 3_000_000_000,
          like_count: 1,
          reply_count: 1,
          retweet_count: 2,
          quote_count: 3,
        }),
        tweetOf(ID_OLDEST, "u2"),
      ],
      [
        userOf("u1", "MixedCase"),
        userOf("u2", "seconduser"),
        userOf("u3", "thirduser"),
      ],
    );
  }

  it("a 3-result page creates 3 approved x_search posts + 3 creators + 3 initial snapshots with denorm columns set", async () => {
    const { client, calls } = makeClient([threeResultPage()]);

    const summary = await discoverX(db, baseOptions(client));

    expect(summary).toEqual({
      skipped: false,
      pagesRead: 1,
      postsRead: 3,
      discovered: 3,
      duplicates: 0,
      banned: 0,
      invalid: 0,
      errors: 0,
      truncated: false,
      degraded: false,
      cursorAdvanced: true,
      durationMs: expect.any(Number),
    });
    expect(await tableCounts()).toEqual({
      creators: 3,
      posts: 3,
      snapshots: 3,
    });

    // Creator built from the author expansion, handle normalized to lowercase.
    const [creator] = await db
      .select()
      .from(creators)
      .where(and(eq(creators.platform, "x"), eq(creators.handle, "mixedcase")));
    expect(creator).toMatchObject({
      displayName: "Display MixedCase",
      avatarUrl: "https://pbs.example/MixedCase.jpg",
      profileUrl: "https://x.com/mixedcase",
      isBanned: false,
    });

    // Post: approved + x_search with canonical URL and denorm columns in the
    // SAME transaction as its initial snapshot (spec 004/005 shared invariant).
    const post = await postByPlatformId(ID_BIG_METRICS);
    expect(post).toMatchObject({
      status: "approved",
      source: "x_search",
      url: `https://x.com/thirduser/status/${ID_BIG_METRICS}`,
      caption: `gm $ANSEM ${ID_BIG_METRICS}`,
      latestViews: 3_000_000_000n,
      latestLikes: 1n,
      latestComments: 1n,
      latestShares: 5n, // retweet 2 + quote 3
    });
    expect(post?.postedAt?.toISOString()).toBe("2026-07-05T08:00:00.000Z");
    expect(post?.latestSnapshotAt?.getTime()).toBe(NOW.getTime());

    const [snapshot] = await db
      .select()
      .from(metricSnapshots)
      .where(eq(metricSnapshots.postId, post?.id ?? ""));
    expect(snapshot).toMatchObject({
      views: 3_000_000_000n,
      likes: 1n,
      comments: 1n,
      shares: 5n,
    });
    expect(snapshot?.capturedAt.getTime()).toBe(NOW.getTime());

    // Cursor = BigInt max of the read ids, committed after the batch.
    const state = await cursorRow();
    expect(state?.cursor).toBe(ID_NEWEST);
    expect(state?.updatedAt.getTime()).toBe(NOW.getTime());

    // First run reads the last 24h only — start_time, never since_id.
    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    expect(firstCall?.path).toBe("/tweets/search/recent");
    expect(firstCall?.params.query).toBe("test-query");
    expect(firstCall?.params.max_results).toBe("100");
    expect(firstCall?.params.start_time).toBe(DAY_BEFORE_ISO);
    expect(firstCall?.params.since_id).toBeUndefined();
    expect(firstCall?.params.expansions).toBe("author_id");
    expect(firstCall?.params["tweet.fields"]).toContain("public_metrics");
    expect(firstCall?.params["tweet.fields"]).toContain("created_at");
  });

  it("re-running the same page creates nothing new (UNIQUE gates) and queries with since_id", async () => {
    await discoverX(db, baseOptions(makeClient([threeResultPage()]).client));
    const before = await tableCounts();

    const rerun = makeClient([threeResultPage()]);
    const summary = await discoverX(db, baseOptions(rerun.client));

    expect(await tableCounts()).toEqual(before);
    expect(summary).toMatchObject({
      discovered: 0,
      duplicates: 3,
      errors: 0,
      cursorAdvanced: true,
    });
    // Cursor row exists now — the run must page from it, not the 24h window.
    const secondCall = rerun.calls[0];
    expect(secondCall?.params.since_id).toBe(ID_NEWEST);
    expect(secondCall?.params.start_time).toBeUndefined();
  });

  it("an already-submitted post id keeps its status, source, and snapshots untouched", async () => {
    const creator = await seedCreator();
    await seedPost(creator.id, {
      platformPostId: "4242",
      status: "pending",
      source: "submission",
    });

    const { client } = makeClient([
      pageOf([tweetOf("4242", "u9")], [userOf("u9", "someoneelse")]),
    ]);
    const summary = await discoverX(db, baseOptions(client));

    expect(summary).toMatchObject({ discovered: 0, duplicates: 1, errors: 0 });
    const post = await postByPlatformId("4242");
    expect(post).toMatchObject({
      status: "pending",
      source: "submission",
      latestViews: 0n,
    });
    // Duplicate results are left EXACTLY as they are — no snapshot append and
    // no stray creator row for the search-result author.
    expect(await tableCounts()).toEqual({
      creators: 1,
      posts: 1,
      snapshots: 0,
    });
  });

  it("a result from a banned creator creates no post; other results still land", async () => {
    await seedCreator({ handle: "badguy", isBanned: true });

    const { client } = makeClient([
      pageOf(
        [tweetOf("501", "u1"), tweetOf("502", "u2")],
        [userOf("u1", "badguy"), userOf("u2", "goodguy")],
      ),
    ]);
    const summary = await discoverX(db, baseOptions(client));

    expect(summary).toMatchObject({
      discovered: 1,
      banned: 1,
      errors: 0,
      cursorAdvanced: true,
    });
    expect(await postByPlatformId("501")).toBeNull();
    expect(await postByPlatformId("502")).not.toBeNull();
    expect(await tableCounts()).toEqual({
      creators: 2,
      posts: 1,
      snapshots: 1,
    });
  });
});

describe("page budget + pagination (spec 005 step 3)", () => {
  it("a 5-page response with budget 3 reads exactly 3 pages and reports truncated: true", async () => {
    const pages = [1, 2, 3, 4, 5].map((n) =>
      pageOf(
        [tweetOf(String(1000 + n), `u${n}`)],
        [userOf(`u${n}`, `pageuser${n}`)],
        { next_token: `t${n}` },
      ),
    );
    const { client, get, calls } = makeClient(pages);

    const summary = await discoverX(db, baseOptions(client));

    expect(get).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({
      pagesRead: 3,
      postsRead: 3,
      discovered: 3,
      truncated: true,
      degraded: false,
      cursorAdvanced: true,
    });
    // Pagination threads the previous page's next_token through.
    expect(calls[0]?.params.next_token).toBeUndefined();
    expect(calls[1]?.params.next_token).toBe("t1");
    expect(calls[2]?.params.next_token).toBe("t2");
    expect((await cursorRow())?.cursor).toBe("1003");
  });

  it("stops at the natural end without truncation when pages run out under budget", async () => {
    const { client, get } = makeClient([
      pageOf([tweetOf("601", "u1")], [userOf("u1", "enduser1")], {
        next_token: "t1",
      }),
      pageOf([tweetOf("602", "u2")], [userOf("u2", "enduser2")]),
    ]);

    const summary = await discoverX(db, baseOptions(client));

    expect(get).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      pagesRead: 2,
      discovered: 2,
      truncated: false,
    });
  });
});

describe("graceful abort (spec 005: 429 → degraded, cursor unchanged)", () => {
  it.each([
    { name: "429", response: rateLimited },
    { name: "transport/provider failure", response: providerError },
  ])(
    "$name on the first call → degraded run, nothing written, cursor unchanged",
    async ({ response }) => {
      await seedCursor("50");
      const { client } = makeClient([response]);

      const summary = await discoverX(db, baseOptions(client));

      expect(summary).toEqual({
        skipped: false,
        pagesRead: 0,
        postsRead: 0,
        discovered: 0,
        duplicates: 0,
        banned: 0,
        invalid: 0,
        errors: 0,
        truncated: false,
        degraded: true,
        cursorAdvanced: false,
        durationMs: expect.any(Number),
      });
      expect(await tableCounts()).toEqual({
        creators: 0,
        posts: 0,
        snapshots: 0,
      });
      expect((await cursorRow())?.cursor).toBe("50");
    },
  );

  it("429 mid-run salvages the already-read page but leaves the cursor for a full re-read", async () => {
    await seedCursor("50");
    const { client, calls } = makeClient([
      pageOf(
        [tweetOf("52", "u1"), tweetOf("51", "u2")],
        [userOf("u1", "miduser1"), userOf("u2", "miduser2")],
        { next_token: "t1" },
      ),
      rateLimited,
    ]);

    const summary = await discoverX(db, baseOptions(client));

    // Reads are paid ($5/1k) — persist what arrived; the unchanged cursor
    // makes the next run re-read this window and the UNIQUE gates dedupe.
    expect(summary).toMatchObject({
      pagesRead: 1,
      discovered: 2,
      degraded: true,
      truncated: false,
      cursorAdvanced: false,
    });
    expect((await cursorRow())?.cursor).toBe("50");
    expect(calls[0]?.params.since_id).toBe("50");
    expect(calls[0]?.params.start_time).toBeUndefined();
  });
});

describe("cursor advances only after a clean batch commit (spec 005 step 5)", () => {
  it("a mid-batch DB failure leaves since_id unchanged; the re-run heals via the UNIQUE gates", async () => {
    const fixture = () =>
      pageOf(
        [tweetOf("702", "u1"), tweetOf("701", "u2")],
        [userOf("u1", "dbuser1"), userOf("u2", "dbuser2")],
      );

    const failing = failNthTransaction(db, 2);
    const summary = await discoverX(
      failing,
      baseOptions(makeClient([fixture()]).client),
    );

    expect(summary).toMatchObject({
      discovered: 1,
      errors: 1,
      cursorAdvanced: false,
      degraded: false,
    });
    expect(await cursorRow()).toBeNull();
    expect(await tableCounts()).toEqual({
      creators: 1,
      posts: 1,
      snapshots: 1,
    });

    const rerun = await discoverX(
      db,
      baseOptions(makeClient([fixture()]).client),
    );

    expect(rerun).toMatchObject({
      discovered: 1,
      duplicates: 1,
      errors: 0,
      cursorAdvanced: true,
    });
    expect((await cursorRow())?.cursor).toBe("702");
    expect(await tableCounts()).toEqual({
      creators: 2,
      posts: 2,
      snapshots: 2,
    });
  });

  it("malformed results are counted invalid and never block the cursor (retry cannot fix bad data)", async () => {
    const goodTweet = tweetOf("100", "u1");
    const noMetrics = { id: "400", author_id: "u1", text: "no metrics" };
    const noAuthor = tweetOf("300", "u404"); // author missing from includes
    const unsafeCounts = tweetOf("200", "u1", {
      impression_count: 2 ** 53, // beyond Number.isSafeInteger — never fabricated
    });
    const noId = { author_id: "u1", text: "no id at all" };

    const { client } = makeClient([
      pageOf(
        [noMetrics, noAuthor, unsafeCounts, goodTweet, noId],
        [userOf("u1", "validuser")],
      ),
    ]);
    const summary = await discoverX(db, baseOptions(client));

    expect(summary).toMatchObject({
      postsRead: 5,
      discovered: 1,
      invalid: 4,
      errors: 0,
      cursorAdvanced: true,
    });
    expect(await tableCounts()).toEqual({
      creators: 1,
      posts: 1,
      snapshots: 1,
    });
    // Cursor covers every readable id — including invalid entries — so a
    // permanently-malformed newest tweet cannot pin the window forever.
    expect((await cursorRow())?.cursor).toBe("400");
  });
});
