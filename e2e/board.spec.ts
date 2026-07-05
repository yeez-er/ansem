// Task 22 (spec 008): board URL-state toggles, load-more, and the rail against
// the seeded story (global.setup runs the idempotent seed, spec 010).
//
// Assertions here stay CLOCK-INDEPENDENT: the all-time board reads the
// denormalized latest_* columns, so the story's all-time winner is
// @bullpostoor whenever the seed ran; daily-board CONTENT is only
// deterministic on the day the seed ran (curves are gated on the post upsert
// and never refresh), so this spec never asserts daily rows. Known local
// edge: a dev server that rendered an unseeded board within the last 60s can
// serve the cached empty board (Task 19 TTL) until a fresh navigation.
import { expect, type Page, test } from "@playwright/test";

const boardRows = (page: Page) => page.locator('a[href^="/creator/"]');

// getByRole name matching is SUBSTRING by default and board rows/rail cards
// embed badge names ("TikTok") and arbitrary captions — always resolve tabs
// inside their labeled group, exact-name only.
const periodTab = (page: Page, name: string) =>
	page
		.getByRole("group", { name: "Period" })
		.getByRole("link", { name, exact: true });
const platformTab = (page: Page, name: string) =>
	page
		.getByRole("group", { name: "Platform" })
		.getByRole("link", { name, exact: true });

test("period and platform toggles are shareable URL state and back-button-safe", async ({
	page,
}) => {
	await page.goto("/");
	await expect(periodTab(page, "Today")).toHaveAttribute(
		"aria-current",
		"page",
	);
	// live countdown: caption server-renders, digits prove hydration ran
	await expect(
		page.getByText(/resets 00:00 UTC · \d{2}:\d{2}:\d{2}/),
	).toBeVisible();

	await periodTab(page, "All Time").click();
	await expect(page).toHaveURL(/\?period=alltime$/);
	await expect(periodTab(page, "All Time")).toHaveAttribute(
		"aria-current",
		"page",
	);
	// seed story: all-time winner, deterministic at any hour
	await expect(boardRows(page).first()).toContainText("@bullpostoor");

	await platformTab(page, "TikTok").click();
	await expect(page).toHaveURL(/\?period=alltime&platform=tiktok$/);
	// wait for rows first so the badge sweep below can never pass vacuously
	await expect(boardRows(page).nth(2)).toBeVisible(); // seed: ≥3 per platform
	await expect(
		boardRows(page).filter({
			hasNot: page.getByRole("img", { name: "TikTok" }),
		}),
	).toHaveCount(0);

	await page.goBack();
	await expect(page).toHaveURL(/\?period=alltime$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/$/);
	await expect(periodTab(page, "Today")).toHaveAttribute(
		"aria-current",
		"page",
	);
});

test("load more appends rows without duplicates", async ({ page }) => {
	await page.goto("/?period=alltime&limit=5");
	const rows = boardRows(page);
	await expect(rows).toHaveCount(5);
	const before = await rows.allInnerTexts();

	await page.getByRole("link", { name: "Load more", exact: true }).click();
	await expect(page).toHaveURL(/limit=30/);
	await expect.poll(() => rows.count()).toBeGreaterThan(5);

	const after = await rows.allInnerTexts();
	expect(after.slice(0, 5)).toEqual(before); // appended, prefix unchanged
	expect(new Set(after).size).toBe(after.length); // no duplicates
	if (after.length < 30) {
		// everything is on screen — no dead Load more control
		await expect(
			page.getByRole("link", { name: "Load more", exact: true }),
		).toHaveCount(0);
	}
});

test("recent-posts rail links out and shows pending for never-polled posts", async ({
	page,
}) => {
	await page.goto("/");
	const rail = page.getByRole("complementary", { name: "Recent posts" });
	// seed pins exactly one never-polled visible post (CSEED0203); .first()
	// tolerates organic unpolled submissions on a dev database
	await expect(rail.getByText("— pending").first()).toBeVisible();
	const outbound = rail.getByRole("link").first();
	await expect(outbound).toHaveAttribute("target", "_blank");
	await expect(outbound).toHaveAttribute("rel", "noopener");
});

test("board rows navigate to the creator page", async ({ page }) => {
	await page.goto("/?period=alltime");
	await boardRows(page).first().click();
	await expect(page).toHaveURL(/\/creator\/[0-9a-f-]{36}$/);
});
