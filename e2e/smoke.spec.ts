import { expect, test } from "@playwright/test";

test("home route responds 200 with a non-empty body", async ({ page }) => {
  const response = await page.goto("/");

  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);

  await expect(page.locator("body")).not.toBeEmpty();
});

test("header shows the brand, tagline, nav links, and sign-in button", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.getByRole("banner");

  await expect(header).toContainText("$ANSEM · THE BLACK BULL");
  await expect(header).toContainText("Post. Farm views. Climb.");
  await expect(
    header.getByRole("link", { name: "Leaderboard" }),
  ).toHaveAttribute("href", "/");
  await expect(header.getByRole("link", { name: "Submit" })).toHaveAttribute(
    "href",
    "/submit",
  );
  await expect(header.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("footer shows official links and the canonical mint with a copy button", async ({
  page,
}) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");

  await expect(footer).toContainText(
    "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump",
  );
  await expect(footer).toContainText("the only real one");
  await expect(
    footer.getByRole("link", { name: "blackbullsol.com" }),
  ).toHaveAttribute("href", "https://blackbullsol.com");
  await expect(
    footer.getByRole("link", { name: "@blackbullsol" }),
  ).toHaveAttribute("href", "https://x.com/blackbullsol");
  await expect(
    footer.getByRole("button", { name: "Copy the $ANSEM mint address" }),
  ).toBeVisible();
});
