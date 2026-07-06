// @vitest-environment node
// Task 27 (spec 009B): the /admin/creators page rendered for real against the
// test DB (admin/page.test precedent) with the client <CreatorsList> stubbed —
// it owns its own jsdom suite. Proves the admin data path end-to-end: a
// session-derived admin context → admin.creators → the roster handed to the
// list; a data-layer failure renders the retry card, never the raw error.
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

// The client list owns its own tests; stub it and capture the roster the page
// hands down so counts + visibility are asserted at the page boundary.
let capturedCreators: Array<{ id: string; handle: string }> = [];
vi.mock("./creators-list", () => ({
  CreatorsList: (props: {
    initialCreators: Array<{ id: string; handle: string }>;
  }) => {
    capturedCreators = props.initialCreators;
    return (
      <div data-testid="list">{props.initialCreators.length} creators</div>
    );
  },
}));

import AdminCreatorsPage from "./page";

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
  capturedCreators = [];
  await truncateAll(db);
});

async function render(): Promise<string> {
  return renderToStaticMarkup(await AdminCreatorsPage());
}

describe("admin creators page", () => {
  it("hands the list every creator with post counts, busiest first", async () => {
    const busy = await seedCreator({ handle: "busy" });
    await seedPost(busy.id, { status: "approved" });
    await seedPost(busy.id, { status: "pending" });
    await seedCreator({ handle: "quiet" });

    const html = await render();

    expect(html).toContain("2 creators");
    expect(capturedCreators.map((c) => c.handle)).toEqual(["busy", "quiet"]);
  });

  it("renders the retry card on a data-layer failure — never the raw error", async () => {
    dbBroken = true;

    const html = await render();

    expect(html).toContain("hit a snag");
    expect(html).toContain('href="/admin/creators"');
    expect(html).not.toContain("db down");
  });
});
