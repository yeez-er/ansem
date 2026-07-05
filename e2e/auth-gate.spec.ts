// Task 4 (spec 009A): the session gate over the real HTTP stack — /submit and
// /admin/** redirect signed-out visitors to /sign-in; public routes stay
// public (they must keep working even with Clerk unreachable).
import { expect, test } from "@playwright/test";

test.describe("signed-out session gate", () => {
	for (const route of ["/submit", "/admin"]) {
		test(`${route} redirects a signed-out visitor to /sign-in`, async ({
			page,
		}) => {
			await page.goto(route);
			await page.waitForURL((url) => url.pathname.startsWith("/sign-in"));
			expect(new URL(page.url()).pathname).toBe("/sign-in");
		});
	}
});

test.describe("public routes stay public", () => {
	test("/ responds 200 without redirecting", async ({ page }) => {
		const response = await page.goto("/");
		expect(response).not.toBeNull();
		expect(response!.status()).toBe(200);
		expect(new URL(page.url()).pathname).toBe("/");
	});

	test("/sign-in serves the catch-all page without a session", async ({
		page,
	}) => {
		const response = await page.goto("/sign-in");
		expect(response).not.toBeNull();
		expect(response!.status()).toBe(200);
		expect(new URL(page.url()).pathname).toBe("/sign-in");
	});
});
