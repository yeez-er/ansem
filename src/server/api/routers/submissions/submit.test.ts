// @vitest-environment node
// Task 6 (spec 002), iteration 1 of 2: submissions.submit core flow against a
// REAL test database — parse → typed errors → banned gate → transactional
// creator-upsert + post-insert dedupe (incl. distinct-transaction concurrency)
// → TikTok short-link resolution with mocked fetch → AUTO_APPROVE flag.
// The rolling 24h rate limit (TOO_MANY_REQUESTS) lands in iteration 2.
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { appRouter } from "@/server/api/root";
import { createCallerFactory, type TRPCContext } from "@/server/api/trpc";
import { creators, posts } from "@/server/db/schema";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";

const testDb = connectTestDb();
const { db } = testDb;

const createCaller = createCallerFactory(appRouter);

// ctx built by hand: userId comes from the session in production (spec 002 —
// never from input), so tests inject it directly; db is the real test client.
function callerAs(userId: string | null) {
  const ctx: TRPCContext = {
    headers: new Headers(),
    userId,
    isAdmin: false,
    db,
  };
  return createCaller(ctx);
}

const X_URL =
  "https://x.com/BlackBull/status/1801234567890123456?s=20&utm_source=share";
const X_CANONICAL = "https://x.com/blackbull/status/1801234567890123456";
const TIKTOK_CANONICAL =
  "https://www.tiktok.com/@dancer/video/7300000000000000001";
const SHORT_LINK = "https://vm.tiktok.com/ZM8abcDEF/";

async function postCount() {
  return (await db.select({ id: posts.id }).from(posts)).length;
}
async function creatorCount() {
  return (await db.select({ id: creators.id }).from(creators)).length;
}

async function seedCreator(
  overrides: Partial<typeof creators.$inferInsert> = {},
) {
  const [row] = await db
    .insert(creators)
    .values({
      platform: "x",
      handle: "blackbull",
      profileUrl: "https://x.com/blackbull",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("creator seed returned no row");
  return row;
}

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("auth and input errors", () => {
  it("unauthenticated call fails with UNAUTHORIZED and writes nothing", async () => {
    const result = await callerAs(null)
      .submissions.submit({ url: X_URL })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "UNAUTHORIZED" });
    expect(await postCount()).toBe(0);
  });

  it.each([
    "https://example.com/some/page",
    "https://x.com/blackbull", // profile link, not a post
    "https://www.youtube.com/watch?v=abc123", // unsupported platform
  ])("unparseable URL %s fails BAD_REQUEST / UNSUPPORTED_URL", async (url) => {
    const result = await callerAs("user_fan_1")
      .submissions.submit({ url })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({
      code: "BAD_REQUEST",
      message: "UNSUPPORTED_URL",
    });
    expect(await postCount()).toBe(0);
    expect(await creatorCount()).toBe(0);
  });
});

describe("happy path", () => {
  it("X post: canonical row, session-derived submitter, pending by default", async () => {
    const result = await callerAs("user_fan_1").submissions.submit({
      url: X_URL,
    });
    expect(result).toMatchObject({ status: "pending", alreadyTracked: false });

    const [post] = await db.select().from(posts);
    expect(post).toMatchObject({
      id: result.postId,
      platform: "x",
      platformPostId: "1801234567890123456",
      url: X_CANONICAL, // rebuilt canonical, query junk stripped, handle lowercased
      status: "pending",
      source: "submission",
      submittedByUserId: "user_fan_1",
    });

    const [creator] = await db.select().from(creators);
    expect(creator).toMatchObject({
      platform: "x",
      handle: "blackbull",
      profileUrl: "https://x.com/blackbull",
      isBanned: false,
    });
    expect(post.creatorId).toBe(creator.id);
  });

  it("TikTok canonical post: creator carries the @-profile URL", async () => {
    await callerAs("user_fan_1").submissions.submit({ url: TIKTOK_CANONICAL });
    const [creator] = await db.select().from(creators);
    expect(creator).toMatchObject({
      platform: "tiktok",
      handle: "dancer",
      profileUrl: "https://www.tiktok.com/@dancer",
    });
  });

  it("Instagram post (no handle in URL): deterministic placeholder creator", async () => {
    await callerAs("user_fan_1").submissions.submit({
      url: "https://instagram.com/reel/DAbCd123xyz/?igsh=junk",
    });
    const [creator] = await db.select().from(creators);
    expect(creator).toMatchObject({
      platform: "instagram",
      handle: "placeholder:DAbCd123xyz",
      displayName: null,
      // canonical post URL stands in until ingestion resolves the author (spec 004)
      profileUrl: "https://www.instagram.com/reel/DAbCd123xyz/",
    });
  });

  it("AUTO_APPROVE_SUBMISSIONS=true inserts status approved", async () => {
    vi.stubEnv("AUTO_APPROVE_SUBMISSIONS", "true");
    const result = await callerAs("user_fan_1").submissions.submit({
      url: X_URL,
    });
    expect(result).toMatchObject({ status: "approved" });
    const [post] = await db.select().from(posts);
    expect(post.status).toBe("approved");
  });
});

describe("dedupe", () => {
  it("duplicate submission returns alreadyTracked and creates NO new rows", async () => {
    const first = await callerAs("user_fan_1").submissions.submit({
      url: X_URL,
    });
    // a different user submitting the same post dedupes too — posts are global
    const second = await callerAs("user_fan_2").submissions.submit({
      url: X_URL,
    });
    expect(second).toStrictEqual({
      postId: first.postId,
      status: "pending",
      alreadyTracked: true,
    });
    expect(await postCount()).toBe(1);
    expect(await creatorCount()).toBe(1);
  });

  it("twitter.com legacy and x.com forms dedupe to one row", async () => {
    await callerAs("user_fan_1").submissions.submit({
      url: "https://twitter.com/BlackBull/status/1801234567890123456",
    });
    const second = await callerAs("user_fan_1").submissions.submit({
      url: X_CANONICAL,
    });
    expect(second.alreadyTracked).toBe(true);
    expect(await postCount()).toBe(1);
  });

  it("reuses an existing creator instead of inserting a second one", async () => {
    const existing = await seedCreator();
    await callerAs("user_fan_1").submissions.submit({ url: X_URL });
    expect(await creatorCount()).toBe(1);
    const [post] = await db.select().from(posts);
    expect(post.creatorId).toBe(existing.id);
  });

  it("two concurrent submissions of the same URL yield exactly one post row (distinct transactions)", async () => {
    const [a, b] = await Promise.all([
      callerAs("user_fan_1").submissions.submit({ url: X_URL }),
      callerAs("user_fan_2").submissions.submit({ url: X_URL }),
    ]);
    expect(await postCount()).toBe(1);
    expect(await creatorCount()).toBe(1);
    expect(a.postId).toBe(b.postId);
    // exactly one of the two actually inserted
    expect([a.alreadyTracked, b.alreadyTracked].sort()).toEqual([false, true]);
  });
});

describe("banned creator", () => {
  it("new post for a banned creator fails FORBIDDEN / CREATOR_BANNED and writes nothing", async () => {
    await seedCreator({ isBanned: true });
    const result = await callerAs("user_fan_1")
      .submissions.submit({ url: X_URL })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({
      code: "FORBIDDEN",
      message: "CREATOR_BANNED",
    });
    expect(await postCount()).toBe(0);
  });

  it("duplicate of a banned creator's post fails FORBIDDEN, not alreadyTracked", async () => {
    await callerAs("user_fan_1").submissions.submit({ url: X_URL });
    await db
      .update(creators)
      .set({ isBanned: true })
      .where(eq(creators.handle, "blackbull"));

    const result = await callerAs("user_fan_2")
      .submissions.submit({ url: X_URL })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({
      code: "FORBIDDEN",
      message: "CREATOR_BANNED",
    });
    expect(await postCount()).toBe(1);
  });
});

describe("TikTok short-link resolution (mocked redirect)", () => {
  it("resolves the redirect once and stores only the canonical id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { location: `${TIKTOK_CANONICAL}?_t=8kJunk&u_code=xyz` },
      }),
    );

    const viaShort = await callerAs("user_fan_1").submissions.submit({
      url: SHORT_LINK,
    });
    expect(viaShort).toMatchObject({ alreadyTracked: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://vm.tiktok.com/ZM8abcDEF", // normalized short link, ONE hop
      expect.objectContaining({ redirect: "manual" }),
    );

    const [post] = await db.select().from(posts);
    expect(post).toMatchObject({
      platform: "tiktok",
      platformPostId: "7300000000000000001",
      url: TIKTOK_CANONICAL, // needsResolution never reaches persistence
    });

    // the same video via its canonical URL dedupes to the SAME row
    const viaCanonical = await callerAs("user_fan_2").submissions.submit({
      url: TIKTOK_CANONICAL,
    });
    expect(viaCanonical).toMatchObject({
      postId: viaShort.postId,
      alreadyTracked: true,
    });
    expect(await postCount()).toBe(1);
  });

  it("network failure fails BAD_REQUEST / UNRESOLVABLE_URL with no rows written", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed"),
    );
    const result = await callerAs("user_fan_1")
      .submissions.submit({ url: SHORT_LINK })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({
      code: "BAD_REQUEST",
      message: "UNRESOLVABLE_URL",
    });
    expect(await postCount()).toBe(0);
    expect(await creatorCount()).toBe(0);
  });

  it.each([
    ["no Location header", undefined],
    ["non-TikTok redirect target", "https://evil.example.com/phish"],
    ["redirect to another short link (no second hop)", SHORT_LINK],
  ])(
    "%s fails UNRESOLVABLE_URL with no rows written",
    async (_name, location) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, {
          status: 301,
          headers: location ? { location } : {},
        }),
      );
      const result = await callerAs("user_fan_1")
        .submissions.submit({ url: SHORT_LINK })
        .catch((e: unknown) => e);
      expect(result).toMatchObject({
        code: "BAD_REQUEST",
        message: "UNRESOLVABLE_URL",
      });
      expect(await postCount()).toBe(0);
      expect(await creatorCount()).toBe(0);
    },
  );
});
