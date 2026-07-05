// @vitest-environment node
// Task 22 (spec 008): the board page rendered for real. The page is an async
// server component returning plain JSX, so instead of source-verification-only
// (the fallback for RSCs that jsdom can't mount) this suite awaits the
// component with real searchParams shapes and asserts renderToStaticMarkup
// output. Everything downstream is live — createTRPCContext → caller → 60s
// response cache → query layer → test DB → DTOs → components; only getDb() is
// redirected at the shared test-db seam.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import {
  installFakeIncrementalCache,
  uninstallFakeIncrementalCache,
} from "@/tests/helpers/incremental-cache";
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";
import BoardPage from "./page";

// page.tsx builds its context through the real createTRPCContext, whose lazy
// db getter calls getDb() — redirect that singleton to the wiped test DB.
// (The factory is hoisted but the closure only reads `db` at render time.)
vi.mock("@/server/db", () => ({ getDb: () => db }));

const testDb = connectTestDb();
const { db } = testDb;
const { seedCreator, seedPost, seedSnapshot } = makeSeeders(db);

beforeAll(async () => {
  await migrateFresh(testDb);
});

afterAll(async () => {
  uninstallFakeIncrementalCache();
  await testDb.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
  installFakeIncrementalCache();
});

type RawSearchParams = Record<string, string | string[] | undefined>;

async function renderBoard(raw: RawSearchParams = {}): Promise<string> {
  const element = await BoardPage({ searchParams: Promise.resolve(raw) });
  return renderToStaticMarkup(element);
}

// Order-robust attribute assertions (layout.test.ts precedent): grab the
// opening tag of the <a> whose exact text is `label`.
function anchorTag(html: string, label: string): string {
  const match = html.match(new RegExp(`<a\\b([^>]*)>${label}</a>`));
  if (!match) throw new Error(`no <a> with exact text "${label}" in markup`);
  return match[1] ?? "";
}

const OBSERVED_AT = new Date("2026-07-01T12:00:00.000Z");

describe("all-time board", () => {
  it("renders ranked rows linking to creator pages, with placeholders unclaimed", async () => {
    const alpha = await seedCreator();
    const placeholder = await seedCreator({
      handle: "placeholder:1899000000000000001",
      platform: "instagram",
    });
    await seedPost(alpha.id, {
      latestViews: 1000n,
      latestLikes: 10n,
      latestComments: 2n,
      latestShares: 1n,
      latestSnapshotAt: OBSERVED_AT,
    });
    await seedPost(placeholder.id, {
      platform: "instagram",
      latestViews: 500n,
      latestSnapshotAt: OBSERVED_AT,
    });

    const html = await renderBoard({ period: "alltime" });

    expect(html).toContain(`href="/creator/${alpha.id}"`);
    expect(html).toContain(`href="/creator/${placeholder.id}"`);
    // rank order: alpha (score 1510) above the placeholder (score 500)
    expect(html.indexOf(`@${alpha.handle}`)).toBeLessThan(
      html.indexOf("Unclaimed creator"),
    );
    // hand-derived spec score (1000 + 10·30 + 2·60 + 1·90) in the stat title
    expect(html).toContain('title="1,510"');
    // the raw placeholder handle never renders (spec 008)
    expect(html).not.toContain("placeholder:1899");
    // the active period is marked; the reset caption belongs to daily only
    expect(anchorTag(html, "All Time")).toContain('aria-current="page"');
    expect(anchorTag(html, "Today")).not.toContain("aria-current");
    expect(html).not.toContain("resets 00:00 UTC");
  });
});

describe("daily board (default)", () => {
  it("renders in-window deltas with the reset caption and the recent-posts rail", async () => {
    const creator = await seedCreator();
    const now = new Date();
    const post = await seedPost(creator.id, {
      latestViews: 1000n,
      latestLikes: 10n,
      latestComments: 2n,
      latestShares: 1n,
      latestSnapshotAt: now,
    });
    await seedSnapshot(post.id, {
      views: 1000n,
      likes: 10n,
      comments: 2n,
      shares: 1n,
      capturedAt: now,
    });
    // never-polled approved post → the rail's "— pending" state
    await seedPost(creator.id, { latestSnapshotAt: null });

    const html = await renderBoard();

    expect(anchorTag(html, "Today")).toContain('aria-current="page"');
    // no baseline before today ⇒ the delta is the full snapshot: 1510
    expect(html).toContain('title="1,510"');
    expect(html).toContain("Recent posts");
    expect(html).toContain("— pending");
    // the caption server-renders WITHOUT clock digits (hydration-safe; the
    // live countdown fills in client-side)
    expect(html).toContain("resets 00:00 UTC");
    expect(html).not.toMatch(/resets 00:00 UTC[^<]*\d/);
  });

  it("falls back to the default board on junk search params instead of crashing", async () => {
    const html = await renderBoard({
      period: "bogus",
      platform: ["x", "tiktok"],
      limit: "NaN",
    });

    expect(anchorTag(html, "Today")).toContain('aria-current="page"');
    expect(anchorTag(html, "All")).toContain('aria-current="page"');
  });
});

describe("empty board", () => {
  it("renders the spec empty state with a submit CTA while controls stay usable", async () => {
    const html = await renderBoard();

    expect(html).toContain(
      "No posts on the board yet. Be the first — submit your post.",
    );
    expect(anchorTag(html, "Submit a post")).toContain('href="/submit"');
    // an empty Today board must still offer the way out to All Time
    expect(anchorTag(html, "All Time")).toContain('href="/?period=alltime"');
    // empty feed → no rail heading
    expect(html).not.toContain("Recent posts");
  });
});

describe("load more", () => {
  it("grows the limit within the API cap and only when more rows exist", async () => {
    const first = await seedCreator();
    const second = await seedCreator();
    const third = await seedCreator();
    await seedPost(first.id, {
      latestViews: 3000n,
      latestSnapshotAt: OBSERVED_AT,
    });
    await seedPost(second.id, {
      latestViews: 2000n,
      latestSnapshotAt: OBSERVED_AT,
    });
    await seedPost(third.id, {
      latestViews: 1000n,
      latestSnapshotAt: OBSERVED_AT,
    });

    const truncated = await renderBoard({ period: "alltime", limit: "2" });
    expect(truncated).toContain(`href="/creator/${second.id}"`);
    expect(truncated).not.toContain(`href="/creator/${third.id}"`);
    expect(anchorTag(truncated, "Load more")).toContain(
      'href="/?period=alltime&amp;limit=27"',
    );

    const full = await renderBoard({ period: "alltime" });
    expect(full).toContain(`href="/creator/${third.id}"`);
    expect(full).not.toContain("Load more");
  });
});

describe("data-layer failure", () => {
  it("renders the friendly retry card and never the raw error", async () => {
    // The exact seam a broken platform cache presents: without the
    // incremental cache the cached caller rejects. CONTROL: prove the raw
    // failure text contains the marker we then assert absent from the page.
    uninstallFakeIncrementalCache();
    const caller = createCallerFactory(appRouter)({
      headers: new Headers(),
      userId: null,
      isAdmin: false,
      db,
    });
    const rawError = await caller.leaderboard
      .get({ period: "alltime" })
      .catch((e: unknown) => e);
    expect(String(rawError)).toMatch(/incrementalCache/);

    const html = await renderBoard({ period: "alltime" });

    expect(html).toContain("The board hit a snag loading");
    // retry preserves the view the user asked for
    expect(anchorTag(html, "Retry")).toContain('href="/?period=alltime"');
    expect(html).not.toContain("incrementalCache");
    expect(html).not.toContain("Load more");
  });
});

describe("source pins (what a render cannot prove)", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

  it("declares force-dynamic as a literal for Next's static analyzer", () => {
    expect(source).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("retries via a document request (reload cta), not a same-URL soft-nav", () => {
    expect(source).toMatch(/reload: true/);
  });
});
