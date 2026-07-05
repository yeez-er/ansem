import { expect, test } from "@playwright/test";

test("home route responds 200 with a non-empty body", async ({ page }) => {
  const response = await page.goto("/");

  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);

  await expect(page.locator("body")).not.toBeEmpty();
});
