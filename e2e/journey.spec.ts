// Task 31 (spec: all): the full-suite end-to-end journey that ties the flow
// together in one continuous run, on top of the idempotent story seed
// (global.setup, spec 010).
//
// TWO halves, split by what the environment can prove:
//
//  1. PUBLIC journey — always runs, CLOCK-INDEPENDENT (board.spec/creator.spec
//     rationale): the all-time board reads the denormalized latest_* columns so
//     @bullpostoor tops it whenever the seed ran; daily CONTENT is only
//     deterministic on seed day, so this journey never asserts daily rows.
//     seed → all-time board → filter TikTok → creator page → recent-posts rail.
//
//  2. SIGNED-IN journey — submit → admin approves → refresh-metrics (mock
//     provider) → the creator surfaces on the board. This half needs a REAL
//     Clerk dev instance (pk_test_/sk_test_ keys can mint a session; the tracked
//     `_placeholder` keys cannot — see global.setup.ts) plus a seeded admin test
//     user. It is CONDITIONALLY REGISTERED: absent those credentials it is not
//     registered at all (no permanently-skipped test in the suite), and it runs
//     the moment the operator supplies:
//       - real NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY (pk_test_/sk_test_)
//       - E2E_CLERK_USER_IDENTIFIER / E2E_CLERK_USER_PASSWORD (a test user whose
//         Clerk id is in ADMIN_USER_IDS)
//       - CRON_SECRET (to trigger the refresh-metrics cron from the test)
//
// No fixed sleeps anywhere: every wait keys off an observable URL / row / text /
// control state (enforced by src/tests/e2e-no-fixed-sleeps.test.ts).

import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { boardRows, periodTab, platformTab } from "./helpers";

// The worker process does not load Next's dotenv files; the dev server does.
// Load .env.local so the signed-in gate below sees the same keys global.setup
// used (each Playwright worker is its own process).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local (CI injects real env) — nothing to load
}

test("public journey: board story → TikTok filter → creator page → rail", async ({
  page,
}) => {
  // Board, all-time: the seed's all-time winner tops it at any run hour.
  await page.goto("/?period=alltime");
  await expect(periodTab(page, "All Time")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(boardRows(page).first()).toContainText("@bullpostoor");

  // Filter to TikTok: every visible row carries the TikTok badge (≥3 per
  // platform by seed design). Wait for rows first so the sweep can't pass
  // vacuously.
  await platformTab(page, "TikTok").click();
  await expect(page).toHaveURL(/\?period=alltime&platform=tiktok$/);
  await expect(boardRows(page).nth(2)).toBeVisible();
  await expect(
    boardRows(page).filter({
      hasNot: page.getByRole("img", { name: "TikTok" }),
    }),
  ).toHaveCount(0);

  // Open the top TikTok creator's profile: 4 stat tiles in order.
  await boardRows(page).first().click();
  await expect(page).toHaveURL(/\/creator\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("@");
  await expect(page.locator("dt")).toHaveText([
    "All-time score",
    "Today's score",
    "Total views",
    "Posts",
  ]);

  // Recent-posts rail on the board: a never-polled post shows "— pending" (never
  // a fake 0) and cards link out safely.
  await page.goto("/");
  const rail = page.getByRole("complementary", { name: "Recent posts" });
  await expect(rail.getByText("— pending").first()).toBeVisible();
  const outbound = rail.getByRole("link").first();
  await expect(outbound).toHaveAttribute("target", "_blank");
  await expect(outbound).toHaveAttribute("rel", "noopener");
});

// ── Signed-in journey (conditionally registered — see file header) ────────────
const secretKey = process.env.CLERK_SECRET_KEY ?? "";
const hasRealClerk = secretKey !== "" && !secretKey.endsWith("_placeholder");
const identifier = process.env.E2E_CLERK_USER_IDENTIFIER;
const password = process.env.E2E_CLERK_USER_PASSWORD;
const cronSecret = process.env.CRON_SECRET;
const canRunSignedIn =
  hasRealClerk && !!identifier && !!password && !!cronSecret;

if (canRunSignedIn) {
  test("signed-in journey: submit → admin approves → creator on the board", async ({
    page,
  }) => {
    // A unique X post id per run so the submission is never an already-tracked
    // no-op (test data — ambient clock is fine outside src/ logic).
    const postId = `9${Date.now()}`;
    const postUrl = `https://x.com/journeytester/status/${postId}`;

    // Sign in via the Clerk password strategy (must load Clerk on a public page
    // first — @clerk/testing/playwright contract).
    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "password",
        identifier: identifier as string,
        password: password as string,
      },
    });

    // Baseline board size so we can prove the new creator ADDS a ranked row.
    await page.goto("/?period=alltime&platform=x&limit=100");
    const baseline = await boardRows(page).count();

    // Submit the post: moderation is on for this journey, so it lands pending
    // (input clears on a real insertion — no celebration on a no-op).
    await page.goto("/submit");
    await page.getByLabel("Post URL").fill(postUrl);
    await expect(page.getByRole("img", { name: "X" })).toBeVisible(); // detect chip
    await page.getByRole("button", { name: "Submit post" }).click();
    await expect(page.getByRole("status")).toContainText("Pending review");
    await expect(page.getByLabel("Post URL")).toHaveValue("");

    // Admin approves it: find the queue row by its outbound post link, approve,
    // and watch the row leave the queue (no reload).
    await page.goto("/admin");
    const queueRow = page
      .getByRole("row")
      .filter({ has: page.locator(`a[href="${postUrl}"]`) });
    await expect(queueRow).toHaveCount(1);
    await queueRow.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status")).toContainText("Post approved");
    await expect(queueRow).toHaveCount(0);

    // Run the ingestion cron (mock provider) so the approved post gets its first
    // snapshot and its creator becomes rankable.
    const cron = await page.request.get("/api/cron/refresh-metrics", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    expect(cron.ok()).toBe(true);

    // The creator now surfaces on the board: poll a cache-busting limit so a
    // stale 60s cache entry (Task 19) can't mask the fresh row.
    await expect
      .poll(async () => {
        await page.goto(
          `/?period=alltime&platform=x&limit=100&t=${Date.now()}`,
        );
        return boardRows(page).count();
      })
      .toBeGreaterThan(baseline);
  });
}

// A discovery-cron fallback smoke that needs no session: without X_BEARER_TOKEN
// discovery is a no-op, but the bearer-auth boundary must still hold. Wrong
// secret → 401 (spec 004/005 manual-curl fallback, verified end-to-end).
test("cron routes reject a missing/wrong bearer secret", async ({
  request,
}) => {
  const unauthorized = await request.get("/api/cron/refresh-metrics", {
    headers: { Authorization: "Bearer wrong-secret" },
  });
  expect(unauthorized.status()).toBe(401);

  const noHeader = await request.get("/api/cron/discover-x");
  expect(noHeader.status()).toBe(401);
});
