// @vitest-environment node
// Task 23 (spec 008): the creator page rendered for real (board page.test.tsx
// precedent) — await the async server component with real params shapes and
// assert renderToStaticMarkup output. Everything downstream is live:
// createTRPCContext → caller → 60s response cache → query layer → test DB →
// DTOs → components; only getDb() is redirected at the shared test-db seam.
// notFound() cases assert the thrown Next digest — the render never completes.
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
import CreatorPage from "./page";

// page.tsx builds its context through the real createTRPCContext, whose lazy
// db getter calls getDb() — redirect that singleton to the wiped test DB.
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

async function renderCreator(id: string): Promise<string> {
  const element = await CreatorPage({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(element);
}

// Capture the outcome unconditionally (never a vacuous negative): a render
// that succeeds yields no digest and fails the notFound assertion loudly.
async function renderOutcome(id: string): Promise<unknown> {
  return CreatorPage({ params: Promise.resolve({ id }) }).then(
    () => "rendered",
    (error: unknown) => error,
  );
}

const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

function digestOf(outcome: unknown): string | undefined {
  if (typeof outcome !== "object" || outcome === null) return undefined;
  if (!("digest" in outcome)) return undefined;
  return String((outcome as { digest: unknown }).digest);
}

// Fixed past instant: before today's UTC window at any real run time, so
// denorm-only seeds never contribute to the daily board (board precedent).
const OBSERVED_AT = new Date("2026-07-01T12:00:00.000Z");

const escapeRe = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Order-robust extraction (page.test.tsx precedent): the whole <a> whose
// href is exactly `href`, nested markup included.
function anchorByHref(html: string, href: string): string {
  const match = html.match(
    new RegExp(`<a\\b[^>]*href="${escapeRe(href)}"[^>]*>(.*?)</a>`, "s"),
  );
  if (!match) throw new Error(`no <a href="${href}"> in markup`);
  return match[0];
}

// The <dd> content of the stat tile labeled `label`.
function tile(html: string, label: string): string {
  const match = html.match(
    new RegExp(`<dt[^>]*>${escapeRe(label)}</dt><dd[^>]*>(.*?)</dd>`, "s"),
  );
  if (!match) throw new Error(`no stat tile labeled "${label}" in markup`);
  return match[1] ?? "";
}

describe("creator profile", () => {
  it("renders header, source-profile link, and hand-derived stat tiles", async () => {
    const creator = await seedCreator({
      displayName: "Bull Poster",
      avatarUrl: "https://example.com/bull.png",
    });
    await seedPost(creator.id, {
      latestViews: 1000n,
      latestLikes: 10n,
      latestComments: 2n,
      latestShares: 1n,
      latestSnapshotAt: OBSERVED_AT,
    });

    const html = await renderCreator(creator.id);

    expect(html).toContain(`@${creator.handle}`);
    expect(html).toContain("Bull Poster");
    const profileLink = anchorByHref(html, creator.profileUrl);
    expect(profileLink).toContain('target="_blank"');
    expect(profileLink).toContain('rel="noopener"');
    // hand-derived spec values: 1000 + 10·30 + 2·60 + 1·90 = 1510 all-time
    expect(tile(html, "All-time score")).toContain('title="1,510"');
    // no in-window snapshots ⇒ today is a TRUE 0 (never blank, never a dash)
    expect(tile(html, "Today&#x27;s score")).toContain(">0<");
    expect(tile(html, "Total views")).toContain('title="1,000"');
    expect(tile(html, "Posts")).toContain(">1<");
  });

  it("scores the today tile from in-window snapshots", async () => {
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

    const html = await renderCreator(creator.id);

    // no baseline before today ⇒ the delta is the full snapshot: 1510
    expect(tile(html, "Today&#x27;s score")).toContain('title="1,510"');
  });

  it("renders a placeholder creator as Unclaimed creator, never the raw handle", async () => {
    const placeholder = await seedCreator({
      handle: "placeholder:1899000000000000042",
      platform: "instagram",
    });
    await seedPost(placeholder.id, {
      platform: "instagram",
      latestViews: 500n,
      latestSnapshotAt: OBSERVED_AT,
    });

    const html = await renderCreator(placeholder.id);

    expect(html).toContain("Unclaimed creator");
    expect(html).not.toContain("placeholder:1899");
  });
});

describe("posts table", () => {
  it("lists approved posts linking out, with hand-derived per-post scores", async () => {
    const creator = await seedCreator();
    const post = await seedPost(creator.id, {
      caption: "bull run incoming",
      latestViews: 1000n,
      latestLikes: 10n,
      latestComments: 2n,
      latestShares: 1n,
      latestSnapshotAt: OBSERVED_AT,
    });
    const rejected = await seedPost(creator.id, {
      status: "rejected",
      latestViews: 9n,
      latestSnapshotAt: OBSERVED_AT,
    });

    const html = await renderCreator(creator.id);

    const row = anchorByHref(html, post.url);
    expect(row).toContain('target="_blank"');
    expect(row).toContain('rel="noopener"');
    expect(row).toContain("bull run incoming");
    expect(row).toContain('title="1,510"'); // score column
    expect(row).toContain('title="1,000"'); // views column
    expect(html).not.toContain(rejected.url); // only approved posts list
  });

  it("shows the pending em-dash for a never-polled post, never a fake 0", async () => {
    const creator = await seedCreator();
    const observed = await seedPost(creator.id, {
      latestViews: 700n,
      latestSnapshotAt: OBSERVED_AT,
    });
    const pending = await seedPost(creator.id, { latestSnapshotAt: null });

    const html = await renderCreator(creator.id);

    const row = anchorByHref(html, pending.url);
    expect(row).toContain("— pending");
    // the denormalized zeros are not observations and never render as counts
    expect(row).not.toContain('title="0"');
    expect(anchorByHref(html, observed.url)).not.toContain("— pending");
  });
});

describe("not found", () => {
  it.each([
    ["unknown uuid", "00000000-0000-0000-0000-000000000000"],
    ["malformed id", "not-a-uuid"],
  ])("%s → notFound(), never an empty page or a 500", async (_label, id) => {
    const outcome = await renderOutcome(id);
    expect(digestOf(outcome)).toBe(NOT_FOUND_DIGEST);
  });

  it("banned creator → notFound(), the profile never leaks", async () => {
    const banned = await seedCreator({ isBanned: true });
    await seedPost(banned.id, {
      latestViews: 5000n,
      latestSnapshotAt: OBSERVED_AT,
    });

    const outcome = await renderOutcome(banned.id);

    expect(digestOf(outcome)).toBe(NOT_FOUND_DIGEST);
  });
});

describe("data-layer failure", () => {
  it("renders the friendly retry card — an outage is not a 404 and never the raw error", async () => {
    const creator = await seedCreator();
    await seedPost(creator.id, {
      latestViews: 100n,
      latestSnapshotAt: OBSERVED_AT,
    });
    // The exact seam a broken platform cache presents (board precedent).
    // CONTROL: prove the raw failure text carries the marker asserted absent.
    uninstallFakeIncrementalCache();
    const caller = createCallerFactory(appRouter)({
      headers: new Headers(),
      userId: null,
      isAdmin: false,
      db,
    });
    const rawError = await caller.leaderboard
      .creator({ creatorId: creator.id })
      .catch((e: unknown) => e);
    expect(String(rawError)).toMatch(/incrementalCache/);

    const html = await renderCreator(creator.id);

    expect(html).toContain("This profile hit a snag loading");
    const retry = anchorByHref(html, `/creator/${creator.id}`);
    expect(retry).toContain("Retry");
    expect(html).not.toContain("incrementalCache");
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
