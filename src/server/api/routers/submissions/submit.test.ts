// @vitest-environment node
// Task 6 (spec 002): submissions.submit against a REAL test database —
// parse → typed errors → banned gate → transactional creator-upsert +
// post-insert dedupe (incl. distinct-transaction concurrency) → TikTok
// short-link resolution with mocked fetch → AUTO_APPROVE flag → rolling 24h
// rate limit (DB-derived posts + resolution attempts).
//
// The rate-limit tests use REAL relative time, not fake timers: the rows the
// procedure itself writes get their timestamps from Postgres defaultNow(),
// which vi.useFakeTimers cannot touch — pinning only the JS clock would split
// the two clocks. Seeding rows at now−1h/−23h/−25h against a 24h window keeps
// every assertion deterministic with an hour of slack.
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
import { creators, posts, resolutionAttempts } from "@/server/db/schema";
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
async function attemptCount() {
  return (
    await db.select({ id: resolutionAttempts.id }).from(resolutionAttempts)
  ).length;
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
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

// Backdated posts already inserted by `userId` inside (or outside) the rolling
// window — the DB-derived quota source. One dedicated creator so assertions on
// creatorCount stay readable.
async function seedQuotaPosts(userId: string, n: number, createdAt: Date) {
  const creator = await seedCreator({
    handle: "quotafarm",
    profileUrl: "https://x.com/quotafarm",
  });
  await db.insert(posts).values(
    Array.from({ length: n }, (_, i) => ({
      creatorId: creator.id,
      platform: "x" as const,
      platformPostId: `1899900000000000${String(i).padStart(3, "0")}`,
      url: `https://x.com/quotafarm/status/1899900000000000${String(i).padStart(3, "0")}`,
      status: "pending" as const,
      source: "submission" as const,
      submittedByUserId: userId,
      createdAt,
    })),
  );
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

describe("rolling 24h rate limit (DB-derived: inserted posts + resolution attempts)", () => {
  const X_URL_2 = "https://x.com/blackbull/status/1801234567890999999";

  it("the 21st submission in the window fails TOO_MANY_REQUESTS and writes nothing", async () => {
    await seedQuotaPosts("user_fan_1", 20, hoursAgo(1));
    const result = await callerAs("user_fan_1")
      .submissions.submit({ url: X_URL })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await postCount()).toBe(20);
    // gate fires right after parse — before the creator upsert
    expect(await creatorCount()).toBe(1);
  });

  it("the 20th submission still succeeds (boundary)", async () => {
    await seedQuotaPosts("user_fan_1", 19, hoursAgo(23));
    const result = await callerAs("user_fan_1").submissions.submit({
      url: X_URL,
    });
    expect(result).toMatchObject({ alreadyTracked: false });
    expect(await postCount()).toBe(20);
  });

  it("the window rolls: posts and attempts older than 24h no longer count", async () => {
    await seedQuotaPosts("user_fan_1", 20, hoursAgo(25));
    await db
      .insert(resolutionAttempts)
      .values({ userId: "user_fan_1", attemptedAt: hoursAgo(25) });
    const result = await callerAs("user_fan_1").submissions.submit({
      url: X_URL,
    });
    expect(result).toMatchObject({ alreadyTracked: false });
  });

  it("quota is per user — another user's window is untouched", async () => {
    await seedQuotaPosts("user_fan_1", 20, hoursAgo(1));
    const result = await callerAs("user_fan_2").submissions.submit({
      url: X_URL,
    });
    expect(result).toMatchObject({ alreadyTracked: false });
  });

  it("an alreadyTracked duplicate does not consume quota", async () => {
    await callerAs("user_fan_1").submissions.submit({ url: X_URL });
    await seedQuotaPosts("user_fan_1", 18, hoursAgo(1)); // 19 of 20 used

    const dup = await callerAs("user_fan_1").submissions.submit({ url: X_URL });
    expect(dup).toMatchObject({ alreadyTracked: true });

    // the 20th slot is still free — the duplicate consumed nothing
    const twentieth = await callerAs("user_fan_1").submissions.submit({
      url: TIKTOK_CANONICAL,
    });
    expect(twentieth).toMatchObject({ alreadyTracked: false });

    const blocked = await callerAs("user_fan_1")
      .submissions.submit({ url: X_URL_2 })
      .catch((e: unknown) => e);
    expect(blocked).toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("failed resolution attempts consume quota even though no post row lands", async () => {
    await seedQuotaPosts("user_fan_1", 19, hoursAgo(1));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed"),
    );

    const failed = await callerAs("user_fan_1")
      .submissions.submit({ url: SHORT_LINK })
      .catch((e: unknown) => e);
    expect(failed).toMatchObject({ message: "UNRESOLVABLE_URL" });
    expect(await attemptCount()).toBe(1);
    expect(await postCount()).toBe(19);

    // 19 posts + 1 attempt = 20 used → next submission is the 21st
    const blocked = await callerAs("user_fan_1")
      .submissions.submit({ url: X_URL })
      .catch((e: unknown) => e);
    expect(blocked).toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("quota check runs BEFORE the redirect fetch — a blocked short link costs no outbound request", async () => {
    await seedQuotaPosts("user_fan_1", 20, hoursAgo(1));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { location: TIKTOK_CANONICAL },
      }),
    );

    const result = await callerAs("user_fan_1")
      .submissions.submit({ url: SHORT_LINK })
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await attemptCount()).toBe(0);
  });

  it("a successful short-link submission costs ONE unit — the attempt converts into the insertion", async () => {
    await seedQuotaPosts("user_fan_1", 19, hoursAgo(1));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { location: TIKTOK_CANONICAL },
      }),
    );

    // the 20th submission succeeds even via short link
    const result = await callerAs("user_fan_1").submissions.submit({
      url: SHORT_LINK,
    });
    expect(result).toMatchObject({ alreadyTracked: false });
    expect(await attemptCount()).toBe(0);
    expect(await postCount()).toBe(20);

    const blocked = await callerAs("user_fan_1")
      .submissions.submit({ url: X_URL })
      .catch((e: unknown) => e);
    expect(blocked).toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("a deduped short link still consumes its resolution attempt (the fetch is never free)", async () => {
    await callerAs("user_fan_2").submissions.submit({ url: TIKTOK_CANONICAL });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { location: TIKTOK_CANONICAL },
      }),
    );

    const result = await callerAs("user_fan_1").submissions.submit({
      url: SHORT_LINK,
    });
    expect(result).toMatchObject({ alreadyTracked: true });
    expect(await attemptCount()).toBe(1);
    expect(await postCount()).toBe(1);
  });
});
