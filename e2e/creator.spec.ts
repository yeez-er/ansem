// Task 23 (spec 008): creator profile page against the seeded story
// (global.setup runs the idempotent seed, spec 010). Clock-independent like
// board.spec.ts: only the all-time winner (@bullpostoor, denorm-backed) and
// structural content are asserted — never daily numbers.
import { expect, test } from "@playwright/test";

test("board row opens the creator profile with stat tiles and outbound post links", async ({
  page,
}) => {
  await page.goto("/?period=alltime");
  await page.locator('a[href^="/creator/"]').first().click();
  await expect(page).toHaveURL(/\/creator\/[0-9a-f-]{36}$/);

  // seed story: the all-time winner tops the board at any run hour
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "@bullpostoor",
  );
  await expect(page.locator("dt")).toHaveText([
    "All-time score",
    "Today's score",
    "Total views",
    "Posts",
  ]);

  const postLink = page
    .getByRole("region", { name: "Posts" })
    .getByRole("link")
    .first();
  await expect(postLink).toHaveAttribute("target", "_blank");
  await expect(postLink).toHaveAttribute("rel", "noopener");
});

test("unknown creator id serves the styled 404, not an empty page or a 500", async ({
  page,
}) => {
  const response = await page.goto(
    "/creator/00000000-0000-0000-0000-000000000000",
  );
  expect(response?.status()).toBe(404);
  await expect(page.getByText("the bull ran off with that page")).toBeVisible();
  // branded chrome proves the 404 renders inside the root layout
  await expect(
    page.getByRole("link", { name: "Back to the board", exact: true }),
  ).toBeVisible();
});
