// Task 4 (spec 009A) + Task 24 (spec 008): the session gate over the real HTTP
// stack. /admin/** still redirects a signed-out visitor to /sign-in at the edge
// (proxy.ts). /submit is publicly reachable and self-gates in-page — a
// signed-out visitor stays on /submit and sees the "Sign in to submit posts."
// gate (the submit mutation is the server-side boundary). Public routes stay
// public — they must keep working even with Clerk unreachable.
import { expect, test } from "@playwright/test";

test.describe("signed-out session gate", () => {
	test("/admin redirects a signed-out visitor to /sign-in", async ({
		page,
	}) => {
		await page.goto("/admin");
		await page.waitForURL((url) => url.pathname.startsWith("/sign-in"));
		expect(new URL(page.url()).pathname).toBe("/sign-in");
	});

	test("/submit stays on the page and shows the in-page sign-in gate", async ({
		page,
	}) => {
		const response = await page.goto("/submit");
		expect(response?.status()).toBe(200);
		expect(new URL(page.url()).pathname).toBe("/submit");
		await expect(page.getByText("Sign in to submit posts.")).toBeVisible();
	});
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
