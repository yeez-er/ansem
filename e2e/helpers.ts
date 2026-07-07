// Shared e2e locators (Task 31): the board-row link and the period/platform
// toggle tabs are addressed identically across board.spec, creator.spec, and
// journey.spec. `getByRole` name matching is SUBSTRING by default and board
// rows / rail cards embed badge names ("TikTok") and arbitrary captions — so
// tabs are always resolved inside their labeled group with an exact name.
//
// journey.spec consumes these. board.spec/creator.spec still carry local copies
// and migrate onto this module the next time they are edited (they currently
// hold unrelated formatter churn in the working tree — not touched here).

import { type Page } from "@playwright/test";

export const boardRows = (page: Page) => page.locator('a[href^="/creator/"]');

export const periodTab = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Period" })
    .getByRole("link", { name, exact: true });

export const platformTab = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Platform" })
    .getByRole("link", { name, exact: true });
