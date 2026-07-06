// @vitest-environment node
// Task 26 (spec 008/009B): the /admin pending page rendered for real against the
// test DB (creator page.test precedent) with the client <PendingQueue> stubbed —
// it owns its own jsdom suite. Proves the admin data path end-to-end: a
// session-derived admin context → adminProcedure → oldest-first, pending-ONLY
// rows handed to the queue; a data-layer failure renders the retry card, never
// the raw error.
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
import { makeSeeders } from "@/tests/helpers/seed";
import {
  connectTestDb,
  migrateFresh,
  truncateAll,
} from "@/tests/helpers/test-db";

// Admin session: createTRPCContext derives isAdmin from auth() + ADMIN_USER_IDS.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "admin_1" }),
}));

// The lazy ctx.db getter resolves getDb() — redirect it to the wiped test DB,
// and let a test flip the connection to prove the retry card.
let dbBroken = false;
vi.mock("@/server/db", () => ({
  getDb: () => {
    if (dbBroken) throw new Error("db down: connection refused");
    return db;
  },
}));

// The client queue owns its own tests; stub it and capture the rows the page
// hands down so ordering + visibility are asserted at the page boundary.
let capturedPosts: Array<{ id: string }> = [];
vi.mock("./pending-queue", () => ({
  PendingQueue: (props: { initialPosts: Array<{ id: string }> }) => {
    capturedPosts = props.initialPosts;
    return <div data-testid="queue">{props.initialPosts.length} pending</div>;
  },
}));

import AdminPendingPage from "./page";

const testDb = connectTestDb();
const { db } = testDb;
const { seedCreator, seedPost } = makeSeeders(db);

beforeAll(async () => {
  process.env.ADMIN_USER_IDS = "admin_1";
  await migrateFresh(testDb);
});

afterAll(async () => {
  await testDb.pool.end();
});

beforeEach(async () => {
  dbBroken = false;
  capturedPosts = [];
  await truncateAll(db);
});

async function render(): Promise<string> {
  return renderToStaticMarkup(await AdminPendingPage());
}

describe("admin pending page", () => {
  it("hands the queue only pending posts, oldest submission first", async () => {
    const creator = await seedCreator();
    const newer = await seedPost(creator.id, {
      status: "pending",
      createdAt: new Date("2026-07-06T00:00:00Z"),
    });
    const older = await seedPost(creator.id, {
      status: "pending",
      createdAt: new Date("2026-07-05T00:00:00Z"),
    });
    await seedPost(creator.id, { status: "approved" });
    await seedPost(creator.id, { status: "rejected" });

    const html = await render();

    expect(html).toContain("2 pending");
    expect(capturedPosts.map((post) => post.id)).toEqual([older.id, newer.id]);
  });

  it("hands the queue an empty list when nothing is pending", async () => {
    const creator = await seedCreator();
    await seedPost(creator.id, { status: "approved" });

    const html = await render();

    expect(html).toContain("0 pending");
    expect(capturedPosts).toEqual([]);
  });

  it("renders the retry card on a data-layer failure — never the raw error", async () => {
    dbBroken = true;

    const html = await render();

    expect(html).toContain("hit a snag");
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain("db down");
  });
});
